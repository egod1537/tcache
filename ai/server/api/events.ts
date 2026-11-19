import type { FastifyInstance } from 'fastify';

import {
  isTerminalStatus,
  toJobStatus,
  type AiJobEvent,
} from '../jobs/ai-job.js';
import { notFound, type AiApiContext } from './context.js';

interface JobParams {
  jobId: string;
}

function encode(event: AiJobEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(toJobStatus(event.job))}\n\n`;
}

export function registerJobEvents(app: FastifyInstance, context: AiApiContext) {
  app.get<{ Params: JobParams }>(
    '/jobs/:jobId/events',
    async (request, reply) => {
      const { jobId } = request.params;
      const existing = await context.jobs.get(jobId);
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      if (!existing) return reply.code(404).send(notFound(jobId));

      let ready = false;
      let closed = false;
      let unsubscribe = () => {};
      const buffered: AiJobEvent[] = [];
      const connection: { heartbeat?: ReturnType<typeof setInterval> } = {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (connection.heartbeat) clearInterval(connection.heartbeat);
        reply.raw.off('close', cleanup);
        reply.raw.off('error', cleanup);
      };
      const end = () => {
        cleanup();
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
      };
      const send = (event: AiJobEvent) => {
        if (closed || reply.raw.destroyed) {
          cleanup();
          return;
        }
        reply.raw.write(encode(event));
        if (isTerminalStatus(event.job.status)) end();
      };

      try {
        reply.raw.once('close', cleanup);
        reply.raw.once('error', cleanup);
        unsubscribe = context.events.subscribe(jobId, (event) => {
          if (ready) send(event);
          else buffered.push(event);
        });
        const snapshot = await context.jobs.get(jobId);
        if (closed || reply.raw.destroyed) {
          cleanup();
          return;
        }
        if (!snapshot) {
          cleanup();
          return reply.code(404).send(notFound(jobId));
        }
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        reply.raw.flushHeaders();
        reply.raw.write(encode({ type: 'snapshot', job: snapshot }));
        ready = true;

        if (isTerminalStatus(snapshot.status)) {
          send({ type: snapshot.status, job: snapshot });
          return;
        }
        for (const event of buffered) {
          // Wall-clock timestamps are not event sequence numbers. In particular,
          // a terminal transition can share the snapshot's millisecond.
          if (
            isTerminalStatus(event.job.status) ||
            Date.parse(event.job.updatedAt) > Date.parse(snapshot.updatedAt)
          )
            send(event);
        }
        if (closed) return;
        let checking = false;
        connection.heartbeat = setInterval(() => {
          if (closed || checking) return;
          checking = true;
          void context.jobs
            .get(jobId)
            .then((job) => {
              if (closed) return;
              if (reply.raw.destroyed || !job) {
                end();
                return;
              }
              if (isTerminalStatus(job.status)) {
                send({ type: job.status, job });
                return;
              }
              reply.raw.write(': heartbeat\n\n');
            })
            .catch(() => {
              request.log.warn(
                { jobId, code: 'JOB_STATE_UNAVAILABLE' },
                'AI Job heartbeat lookup failed',
              );
              end();
            })
            .finally(() => {
              checking = false;
            });
        }, 15_000);
      } catch (error) {
        cleanup();
        if (!reply.raw.headersSent && !reply.raw.destroyed) throw error;
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );
}
