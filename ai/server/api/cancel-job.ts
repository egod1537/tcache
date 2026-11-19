import type { FastifyInstance } from 'fastify';

import { notFound, type AiApiContext } from './context.js';
import { getOwnedJob } from './session.js';

interface JobParams {
  jobId: string;
}

export function registerCancelJob(app: FastifyInstance, context: AiApiContext) {
  app.post<{ Params: JobParams }>(
    '/jobs/:jobId/cancel',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { jobId } = request.params;
      if (!(await getOwnedJob(context, request, jobId))) {
        return reply.code(404).send(notFound(jobId));
      }
      const job = await context.jobs.cancel(jobId);
      if (!job) return reply.code(404).send(notFound(request.params.jobId));
      return { jobId: job.jobId, status: job.status };
    },
  );
}
