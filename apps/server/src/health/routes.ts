import type { ServiceStatus } from '@tcache/common';
import type { FastifyPluginAsync } from 'fastify';

export interface HealthRoutesOptions {
  environment: string;
  version: string;
  getRedisStatus: () => Promise<'ok' | 'error'>;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/health', async () => ({ status: 'ok' as const }));

  app.get<{ Reply: ServiceStatus }>('/status', async () => ({
    status: 'ok',
    service: 'tcache',
    version: options.version,
    environment: options.environment,
    uptime: Math.floor(process.uptime()),
    redis: await options.getRedisStatus(),
  }));
};
