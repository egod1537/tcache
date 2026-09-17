import { buildApp } from './app.js';
import { createAiCachePolicy } from './ai-cache/cache/policy.js';
import { RedisAiCacheRepository } from './ai-cache/cache/repository.js';
import { InMemoryAiJobEventBus } from './ai-cache/jobs/ai-job-events.js';
import { AiJobRunner } from './ai-cache/jobs/ai-job-runner.js';
import { AiJobService } from './ai-cache/jobs/ai-job-service.js';
import { RedisAiJobStore } from './ai-cache/jobs/ai-job-store.js';
import { GeminiAiProvider } from './ai-cache/providers/gemini/client.js';
import { MockAiProvider } from './ai-cache/providers/mock/client.js';
import { AiProviderRegistry } from './ai-cache/providers/provider.js';
import { loadConfig } from './config.js';
import { createRedisClient, getRedisStatus } from './redis/client.js';
import { createRouteCachePolicy } from './route-cache/cache/policy.js';
import { RedisRouteCacheRepository } from './route-cache/cache/repository.js';
import { InMemoryRouteJobEventBus } from './route-cache/jobs/route-job-events.js';
import { RouteJobRunner } from './route-cache/jobs/route-job-runner.js';
import { RouteJobService } from './route-cache/jobs/route-job-service.js';
import { RedisRouteJobStore } from './route-cache/jobs/route-job-store.js';
import { GoogleRouteProvider } from './route-cache/providers/google/client.js';
import { MockRouteProvider } from './route-cache/providers/mock/client.js';

const config = loadConfig();
const redis = createRedisClient(config.redisUrl);
const routeJobStore = new RedisRouteJobStore(redis, config.routeJobTtlSeconds);
const routeEvents = new InMemoryRouteJobEventBus();
const routeCache = new RedisRouteCacheRepository(redis);
const routeProvider =
  config.routeProvider === 'google'
    ? new GoogleRouteProvider(config.googleMapsApiKey)
    : new MockRouteProvider();
const routeRunner = new RouteJobRunner({
  store: routeJobStore,
  events: routeEvents,
  cache: routeCache,
  cachePolicy: createRouteCachePolicy(config.routeCacheTtlSeconds),
  provider: routeProvider,
  providerTimeoutMs: config.routeProviderTimeoutMs,
});
const routeJobs = new RouteJobService(routeJobStore, routeEvents, routeRunner);
const aiJobStore = new RedisAiJobStore(redis, config.aiJobTtlSeconds);
const aiEvents = new InMemoryAiJobEventBus();
const aiCache = new RedisAiCacheRepository(redis);
const aiProvider =
  config.aiProvider === 'gemini'
    ? new GeminiAiProvider(config.geminiApiKey)
    : new MockAiProvider();
const aiProviders = new AiProviderRegistry([aiProvider]);
const aiRunner = new AiJobRunner({
  store: aiJobStore,
  events: aiEvents,
  cache: aiCache,
  cachePolicy: createAiCachePolicy(config.aiCacheTtlSeconds),
  providers: aiProviders,
  providerTimeoutMs: config.aiProviderTimeoutMs,
});
const aiJobs = new AiJobService(aiJobStore, aiEvents, aiRunner);

const app = buildApp({
  environment: config.nodeEnv,
  version: config.gitCommitSha,
  getRedisStatus: () => getRedisStatus(redis),
  logger: true,
  routeCache: { jobs: routeJobs, events: routeEvents },
  aiCache: { jobs: aiJobs, events: aiEvents },
});

redis.on('error', (error) => {
  app.log.error({ error }, 'Redis connection error');
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  await app.close();

  if (redis.isOpen) {
    await redis.quit();
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await redis.connect();
  const resumedJobs = await routeJobs.resumePending();
  if (resumedJobs) app.log.info({ resumedJobs }, 'Resumed pending Route Jobs');
  const resumedAiJobs = await aiJobs.resumePending();
  if (resumedAiJobs) app.log.info({ resumedAiJobs }, 'Resumed pending AI Jobs');
  if (config.routeProvider === 'google' && !config.googleMapsApiKey) {
    app.log.warn(
      'ROUTE_PROVIDER is google but GOOGLE_MAPS_API_KEY is not set; Route Jobs will fail',
    );
  } else if (config.routeProvider === 'mock') {
    app.log.warn('Using the mock route provider');
  }
  if (config.aiProvider === 'gemini' && !config.geminiApiKey) {
    app.log.warn(
      'AI_PROVIDER is gemini but GEMINI_API_KEY is not set; AI Jobs will fail',
    );
  } else if (config.aiProvider === 'mock') {
    app.log.warn('Using the mock AI provider');
  }
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
