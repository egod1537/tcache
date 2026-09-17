import Fastify, { type FastifyServerOptions } from 'fastify';

import type { AiApiContext } from '../../../ai/server/api/context.js';
import { aiCacheRoutes } from '../../../ai/server/routes.js';
import type { RouteApiContext } from '../../../route/server/api/context.js';
import { routeCacheRoutes } from '../../../route/server/routes.js';
import { healthRoutes } from './health/routes.js';

export interface BuildAppOptions {
  environment?: string;
  version?: string;
  getRedisStatus?: () => Promise<'ok' | 'error'>;
  getPostgresStatus?: () => Promise<'ok' | 'error'>;
  logger?: FastifyServerOptions['logger'];
  routeCache?: RouteApiContext;
  aiCache?: AiApiContext;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.register(healthRoutes, {
    environment: options.environment ?? 'development',
    version: options.version ?? 'dev',
    getRedisStatus: options.getRedisStatus ?? (async () => 'error'),
    getPostgresStatus: options.getPostgresStatus ?? (async () => 'error'),
  });
  app.register(routeCacheRoutes, {
    prefix: '/api/route',
    ...(options.routeCache ? { context: options.routeCache } : {}),
  });
  app.register(aiCacheRoutes, {
    prefix: '/api/ai',
    ...(options.aiCache ? { context: options.aiCache } : {}),
  });

  return app;
}
