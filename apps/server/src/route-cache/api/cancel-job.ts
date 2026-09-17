import type { FastifyInstance } from 'fastify';

import { notFound, type RouteApiContext } from './context.js';

interface JobParams {
  jobId: string;
}

export function registerCancelJob(
  app: FastifyInstance,
  context: RouteApiContext,
) {
  app.post<{ Params: JobParams }>(
    '/jobs/:jobId/cancel',
    async (request, reply) => {
      const job = await context.jobs.cancel(request.params.jobId);
      if (!job) return reply.code(404).send(notFound(request.params.jobId));
      return { jobId: job.jobId, status: job.status };
    },
  );
}
