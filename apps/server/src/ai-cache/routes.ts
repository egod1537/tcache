import type { PingResponse } from '@tcache/common';
import type { FastifyPluginAsync } from 'fastify';

export const aiCacheRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: PingResponse }>('/ping', async () => ({
    system: 'ai-cache',
    status: 'ok',
  }));
};
