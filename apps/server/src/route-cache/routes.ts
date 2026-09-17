import type { PingResponse } from '@tcache/common';
import type { FastifyPluginAsync } from 'fastify';

export const routeCacheRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: PingResponse }>('/ping', async () => ({
    system: 'route-cache',
    status: 'ok',
  }));
};
