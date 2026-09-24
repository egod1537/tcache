import type { FastifyInstance } from 'fastify';
import {
  isMatrixTerminalStatus,
  toMatrixJobStatus,
  type MatrixJobEvent,
} from '../matrix/matrix-job.js';
import { matrixNotFound, type MatrixApiContext } from './matrix-context.js';

interface Params {
  jobId: string;
}

function encode(event: MatrixJobEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify({ type: event.type, job: toMatrixJobStatus(event.job) })}\n\n`;
}

export function registerMatrixEvents(
  app: FastifyInstance,
  context: MatrixApiContext,
) {
  app.get<{ Params: Params }>(
    '/matrix/jobs/:jobId/events',
    async (request, reply) => {
      const { jobId } = request.params;
      const existing = await context.jobs.get(jobId);
      if (!existing) return reply.code(404).send(matrixNotFound(jobId));
      let closed = false;
      let ready = false;
      const buffered: MatrixJobEvent[] = [];
      const connection: { heartbeat?: ReturnType<typeof setInterval> } = {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (connection.heartbeat) clearInterval(connection.heartbeat);
      };
      const send = (event: MatrixJobEvent) => {
        if (closed || reply.raw.destroyed) return;
        reply.raw.write(encode(event));
        if (!['progress', 'snapshot'].includes(event.type)) {
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
        if (Date.parse(event.job.updatedAt) > Date.parse(snapshot.updatedAt)) {
          send(event);
        }
      }
      if (isMatrixTerminalStatus(snapshot.status) && !closed) {
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
