import type { FastifyInstance } from 'fastify';

import { toJobStatus } from '../jobs/ai-job.js';
import { notFound, type AiApiContext } from './context.js';
import { getOwnedJob, readSessionOwner } from './session.js';

interface JobParams {
  jobId: string;
}

interface ListQuery {
  limit?: string;
}

export function registerGetJob(app: FastifyInstance, context: AiApiContext) {
  app.get<{ Querystring: ListQuery }>('/jobs', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const owner = readSessionOwner(request);
    if (!owner) return { jobs: [] };
    const parsed = Number(request.query.limit ?? '50');
    const limit = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 50;
    const jobs = await context.jobs.list(limit, owner);
    return { jobs: jobs.map(toJobStatus) };
  });

  app.get<{ Params: JobParams }>('/jobs/:jobId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const job = await getOwnedJob(context, request, request.params.jobId);
    if (!job) return reply.code(404).send(notFound(request.params.jobId));
    return toJobStatus(job);
  });
}
