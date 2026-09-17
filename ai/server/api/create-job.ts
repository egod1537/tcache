import type { FastifyInstance } from 'fastify';

import { normalizeAiRequest } from '../types/ai.js';
import type { AiApiContext } from './context.js';

export function registerCreateJob(app: FastifyInstance, context: AiApiContext) {
  app.post<{ Body: unknown }>('/jobs', async (request, reply) => {
    let input;
    try {
      input = normalizeAiRequest(request.body, context.requestDefaults);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid AI request',
        },
      });
    }
    const job = await context.jobs.create(input);
    return reply.code(202).send({
      jobId: job.jobId,
      status: job.status,
      eventsUrl: `/api/ai/jobs/${job.jobId}/events`,
      resultUrl: `/api/ai/jobs/${job.jobId}/result`,
    });
  });
}
