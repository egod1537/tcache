import type { FastifyInstance } from 'fastify';
import { toMatrixJobStatus } from '../matrix/matrix-job.js';
import { matrixNotFound, type MatrixApiContext } from './matrix-context.js';

interface Params {
  jobId: string;
}

export function registerGetMatrixJob(
  app: FastifyInstance,
  context: MatrixApiContext,
) {
  app.get<{ Params: Params }>('/matrix/jobs/:jobId', async (request, reply) => {
    const job = await context.jobs.get(request.params.jobId);
    if (!job) return reply.code(404).send(matrixNotFound(request.params.jobId));
    return toMatrixJobStatus(job);
  });
}
