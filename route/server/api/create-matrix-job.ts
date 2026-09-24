import type { FastifyInstance } from 'fastify';
import { normalizeMatrixRequest } from '../matrix/matrix-request.js';
import type { MatrixApiContext } from './matrix-context.js';

export function registerCreateMatrixJob(
  app: FastifyInstance,
  context: MatrixApiContext,
) {
  app.post<{ Body: unknown }>('/matrix/jobs', async (request, reply) => {
    let input;
    try {
      input = normalizeMatrixRequest(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_MATRIX_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid matrix request',
        },
      });
    }
    const job = await context.jobs.create(input);
    return reply.code(202).send({
      jobId: job.jobId,
      status: job.status,
      statusUrl: `/api/route/matrix/jobs/${job.jobId}`,
      eventsUrl: `/api/route/matrix/jobs/${job.jobId}/events`,
      resultUrl: `/api/route/matrix/jobs/${job.jobId}/result`,
    });
  });
}
