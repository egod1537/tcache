import type { FastifyInstance } from 'fastify';

import { normalizePublicRouteRequest } from '../types/route.js';
import type { RouteApiContext } from './context.js';

export function registerCreateJob(
  app: FastifyInstance,
  context: RouteApiContext,
) {
  app.post<{ Body: unknown }>('/jobs', async (request, reply) => {
    let input;
    let selection;
    try {
      input = normalizePublicRouteRequest(request.body);
      selection = context.jobs.selectProvider(input);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ROUTE_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid route request',
        },
      });
    }

    const job = await context.jobs.create(
      input,
      selection,
      redactClientRequest(request.body),
    );
    return reply.code(202).send({
      jobId: job.jobId,
      status: job.status,
      eventsUrl: `/api/route/jobs/${job.jobId}/events`,
      resultUrl: `/api/route/jobs/${job.jobId}/result`,
    });
  });
}

function redactClientRequest(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b(Bearer|KakaoAK)\s+\S+/gi, '$1 [REDACTED]')
      .replace(
        /([?&](?:api[-_]?key|token|secret|password)=)[^&#\s]*/gi,
        '$1[REDACTED]',
      );
  }
  if (Array.isArray(value)) return value.map(redactClientRequest);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      /authorization|api[-_]?key|token|secret|password/i.test(key)
        ? '[REDACTED]'
        : redactClientRequest(child),
    ]),
  );
}
