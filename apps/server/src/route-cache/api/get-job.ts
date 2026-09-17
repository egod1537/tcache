import type { FastifyInstance } from 'fastify';

import { toJobStatus } from '../jobs/route-job.js';
import { notFound, type RouteApiContext } from './context.js';

interface JobParams {
  jobId: string;
}

interface ListQuery {
  limit?: string;
}

export function registerGetJob(app: FastifyInstance, context: RouteApiContext) {
  app.get<{ Querystring: ListQuery }>('/jobs', async (request) => {
    const parsed = Number(request.query.limit ?? '50');
    const limit = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 50;
    const jobs = await context.jobs.list(limit);
    return { jobs: jobs.map(toJobStatus) };
  });

  app.get<{ Params: JobParams }>('/jobs/:jobId', async (request, reply) => {
    const job = await context.jobs.get(request.params.jobId);
    if (!job) return reply.code(404).send(notFound(request.params.jobId));
    return toJobStatus(job);
  });
}
