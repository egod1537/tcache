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
      if (!existing) return reply.code(404).send(notFound(jobId));

      let ready = false;
      let closed = false;
      const buffered: AiJobEvent[] = [];
      const connection: { heartbeat?: ReturnType<typeof setInterval> } = {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (connection.heartbeat) clearInterval(connection.heartbeat);
      };
      const send = (event: AiJobEvent) => {
        if (closed || reply.raw.destroyed) return;
        reply.raw.write(encode(event));
        if (event.type !== 'progress' && event.type !== 'snapshot') {
          cleanup();
          reply.raw.end();
        }
      };
      const unsubscribe = context.events.subscribe(jobId, (event) => {
        if (ready) send(event);
        else buffered.push(event);
      });

      const snapshot = (await context.jobs.get(jobId)) ?? existing;
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

      for (const event of buffered) {
        if (Date.parse(event.job.updatedAt) > Date.parse(snapshot.updatedAt))
          send(event);
      }
      if (isTerminalStatus(snapshot.status) && !closed) {
        send({ type: snapshot.status, job: snapshot });
        return;
      }
      connection.heartbeat = setInterval(() => {
        if (!closed && !reply.raw.destroyed) reply.raw.write(': heartbeat\n\n');
      }, 15_000);
      reply.raw.on('close', cleanup);
    },
  );
}
