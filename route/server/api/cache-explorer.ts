import type { FastifyInstance } from 'fastify';

import type { RouteCacheInspector } from '../cache/inspector.js';

interface CacheListQuery {
  limit?: string;
}

interface CacheEntryQuery {
  key?: string;
}

export function registerRouteCacheExplorer(
  app: FastifyInstance,
  inspector: RouteCacheInspector,
) {
  app.get<{ Querystring: CacheListQuery }>('/cache', async (request, reply) => {
    const limit = Number(request.query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'limit must be an integer between 1 and 100',
        },
      });
    }
    return { entries: await inspector.list(limit) };
  });

  app.get<{ Querystring: CacheEntryQuery }>(
    '/cache/entry',
    async (request, reply) => {
      const key = request.query.key?.trim();
      if (!key) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'key is required',
          },
        });
      }
      const entry = await inspector.get(key);
      if (!entry) {
        return reply.code(404).send({
          error: {
            code: 'CACHE_ENTRY_NOT_FOUND',
            message: 'Route cache entry was not found or has expired',
          },
        });
      }
      return entry;
    },
  );
}
