import type { FastifyInstance } from 'fastify';

import { OpenWebUIUnavailableError } from '../providers/openwebui/client.js';
import type { AiApiContext } from './context.js';

export function registerOpenWebUIModels(
  app: FastifyInstance,
  context: AiApiContext,
) {
  app.get('/providers/openwebui/models', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!context.openWebUIModels) {
      return reply.code(503).send({
        error: {
          code: 'OPENWEBUI_UNAVAILABLE',
          message: 'OpenWebUI model discovery is not configured',
        },
      });
    }
    try {
      return {
        provider: 'openwebui',
        models: await context.openWebUIModels.list(),
      };
    } catch (error) {
      const message =
        error instanceof OpenWebUIUnavailableError
          ? error.message
          : 'OpenWebUI model discovery is unavailable';
      request.log.warn({ error }, 'OpenWebUI model discovery failed');
      return reply.code(503).send({
        error: { code: 'OPENWEBUI_UNAVAILABLE', message },
      });
    }
  });
}
