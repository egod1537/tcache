import type { FastifyInstance } from 'fastify';

import { normalizeRouteRequest } from '../types/route.js';
import type { RouteApiContext } from './context.js';

export function registerCreateJob(
  app: FastifyInstance,
  context: RouteApiContext,
) {
  app.post<{ Body: unknown }>('/jobs', async (request, reply) => {
    let input;
    try {
      input = normalizeRouteRequest(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid route request',
        },
      });
    }

    const job = await context.jobs.create(input);
    return reply.code(202).send({
      jobId: job.jobId,
      status: job.status,
      eventsUrl: `/api/route/jobs/${job.jobId}/events`,
      resultUrl: `/api/route/jobs/${job.jobId}/result`,
    });
  });
}
