import type { FastifyInstance } from 'fastify';
import { matrixNotFound, type MatrixApiContext } from './matrix-context.js';

interface Params {
  jobId: string;
}

export function registerGetMatrixResult(
  app: FastifyInstance,
  context: MatrixApiContext,
) {
  app.get<{ Params: Params }>(
    '/matrix/jobs/:jobId/result',
    async (request, reply) => {
      const job = await context.jobs.get(request.params.jobId);
      if (!job) {
        return reply.code(404).send(matrixNotFound(request.params.jobId));
      }
      if (job.status === 'completed' && job.result) return job.result;
      if (job.status === 'failed' || job.status === 'cancelled') {
        return reply.code(409).send({ error: job.error });
      }
      return reply.code(409).send({
        error: {
          code: 'JOB_NOT_COMPLETED',
          message: 'Matrix job is not completed.',
        },
      });
    },
  );
}
