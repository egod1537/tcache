import type { FastifyInstance } from 'fastify';
import { matrixNotFound, type MatrixApiContext } from './matrix-context.js';

interface Params {
  jobId: string;
}

export function registerCancelMatrixJob(
  app: FastifyInstance,
  context: MatrixApiContext,
) {
  app.post<{ Params: Params }>(
    '/matrix/jobs/:jobId/cancel',
    async (request, reply) => {
      const job = await context.jobs.cancel(request.params.jobId);
      if (!job) {
        return reply.code(404).send(matrixNotFound(request.params.jobId));
      }
      return { jobId: job.jobId, status: job.status };
    },
  );
}
