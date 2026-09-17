import type { FastifyInstance } from 'fastify';

import { notFound, type RouteApiContext } from './context.js';

interface JobParams {
  jobId: string;
}

export function registerGetResult(
  app: FastifyInstance,
  context: RouteApiContext,
) {
  app.get<{ Params: JobParams }>(
    '/jobs/:jobId/result',
    async (request, reply) => {
      const job = await context.jobs.get(request.params.jobId);
      if (!job) return reply.code(404).send(notFound(request.params.jobId));

      if (job.status === 'completed') {
        return {
          jobId: job.jobId,
          status: job.status,
          cache: job.cache,
          provider: job.provider,
          result: job.result,
        };
      }

      if (job.status === 'failed') {
        return reply.code(409).send({
          jobId: job.jobId,
          status: job.status,
          error: job.error,
        });
      }

      if (job.status === 'cancelled') {
        return reply.code(409).send({
          jobId: job.jobId,
          status: job.status,
          error: job.error,
        });
      }

      return reply.code(202).send({ jobId: job.jobId, status: job.status });
    },
  );
}
