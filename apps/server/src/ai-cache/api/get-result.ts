import type { FastifyInstance } from 'fastify';

import { notFound, type AiApiContext } from './context.js';

interface JobParams {
  jobId: string;
}

export function registerGetResult(app: FastifyInstance, context: AiApiContext) {
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
          model: job.model,
          result: job.result,
        };
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        return reply.code(409).send({
          jobId: job.jobId,
          status: job.status,
          provider: job.provider,
          model: job.model,
          error: job.error,
        });
      }
      return reply.code(202).send({
        jobId: job.jobId,
        status: job.status,
        provider: job.provider,
        model: job.model,
      });
    },
  );
}
