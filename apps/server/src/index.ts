import { buildApp } from './app.js';
import { createAiCachePolicy } from '../../../ai/server/cache/policy.js';
import { RedisAiCacheRepository } from '../../../ai/server/cache/repository.js';
import { InMemoryAiJobEventBus } from '../../../ai/server/jobs/ai-job-events.js';
import { AiJobRunner } from '../../../ai/server/jobs/ai-job-runner.js';
import { AiJobService } from '../../../ai/server/jobs/ai-job-service.js';
import { RedisAiJobStore } from '../../../ai/server/jobs/ai-job-store.js';
import { GeminiAiProvider } from '../../../ai/server/providers/gemini/client.js';
import { MockAiProvider } from '../../../ai/server/providers/mock/client.js';
import { OpenWebUIAiProvider } from '../../../ai/server/providers/openwebui/client.js';
import { OpenWebUIModelService } from '../../../ai/server/providers/openwebui/models.js';
import { AiProviderRegistry } from '../../../ai/server/providers/provider.js';
import { createRouteCachePolicy } from '../../../route/server/cache/policy.js';
import { RedisRouteCacheRepository } from '../../../route/server/cache/repository.js';
import { RedisRouteCacheInspector } from '../../../route/server/cache/inspector.js';
import { RepositoryRouteAnalyticsRecorder } from '../../../route/server/analytics/recorder.js';
import { PostgresRouteAnalyticsRepository } from '../../../route/server/analytics/repository.js';
import { InMemoryRouteJobEventBus } from '../../../route/server/jobs/route-job-events.js';
import { RouteJobRunner } from '../../../route/server/jobs/route-job-runner.js';
import { RouteJobService } from '../../../route/server/jobs/route-job-service.js';
import { RedisRouteJobStore } from '../../../route/server/jobs/route-job-store.js';
import { GoogleRouteProvider } from '../../../route/server/providers/google/client.js';
import { KakaoMobilityRouteProvider } from '../../../route/server/providers/kakao/mobility.js';
import { KakaoMapsRouteProvider } from '../../../route/server/providers/kakao/transit.js';
import { MockRouteProvider } from '../../../route/server/providers/mock/client.js';
import { NavitimeRouteProvider } from '../../../route/server/providers/navitime/client.js';
import { EkispertRouteProvider } from '../../../route/server/providers/ekispert/provider.js';
import { OtpRouteProvider } from '../../../route/server/providers/otp/provider.js';
import { RouteResolver } from '../../../route/server/resolver/route-resolver.js';
import {
  DefaultRouteProviderResolver,
  RouteProviderRegistry,
} from '../../../route/server/resolver/provider-resolver.js';
import { RedisMatrixJobStore } from '../../../route/server/matrix/matrix-job-store.js';
import { InMemoryMatrixJobEventBus } from '../../../route/server/matrix/matrix-job-events.js';
import { MatrixJobRunner } from '../../../route/server/matrix/matrix-job-runner.js';
import { MatrixJobService } from '../../../route/server/matrix/matrix-job-service.js';
import { loadConfig } from './config.js';
import { closeDatabasePool, createDatabasePool } from './db/client.js';
import { PostgresHealthMonitor } from './db/health.js';
import { runMigrations } from './db/migrations.js';
import { createRedisClient, getRedisStatus } from './redis/client.js';

const config = loadConfig();
const redis = createRedisClient(config.redisUrl);
const database = createDatabasePool(config.databaseUrl);
const postgres = new PostgresHealthMonitor(database);
const routeAnalyticsRepository = database
  ? new PostgresRouteAnalyticsRepository(database)
  : undefined;
const routeAnalyticsRecorder = routeAnalyticsRepository
  ? new RepositoryRouteAnalyticsRecorder(routeAnalyticsRepository, {
      timeZone: config.routeTimeZone,
    })
  : undefined;
const routeJobStore = new RedisRouteJobStore(redis, config.routeJobTtlSeconds);
const routeEvents = new InMemoryRouteJobEventBus();
const routeCache = new RedisRouteCacheRepository(redis);
const routeCacheInspector = new RedisRouteCacheInspector(redis);
const googleRouteProvider = new GoogleRouteProvider(config.googleMapsApiKey);
const kakaoMobilityRouteProvider = new KakaoMobilityRouteProvider(
  config.kakaoMobilityApiKey,
);
const kakaoMapsRouteProvider = new KakaoMapsRouteProvider(
  config.kakaoRestApiKey,
);
const navitimeRouteProvider = new NavitimeRouteProvider(
  config.navitimeApiKey,
  config.navitimeApiBaseUrl,
);
const ekispertRouteProvider = new EkispertRouteProvider(
  config.ekispertApiKey,
  config.ekispertApiBaseUrl,
);
const otpRouteProvider = new OtpRouteProvider({
  baseUrl: config.otpBaseUrl,
  enabled: config.otpProviderEnabled,
  timeoutMs: config.otpRequestTimeoutMs,
  ...(config.otpVersion ? { otpVersion: config.otpVersion } : {}),
  ...(config.otpGraphBuildId ? { graphBuildId: config.otpGraphBuildId } : {}),
  ...(config.otpGtfsDatasetVersion
    ? { gtfsDatasetVersion: config.otpGtfsDatasetVersion }
    : {}),
  ...(config.otpOsmDatasetVersion
    ? { osmDatasetVersion: config.otpOsmDatasetVersion }
    : {}),
});
const mockRouteProvider = new MockRouteProvider();
const routeProviders = new RouteProviderRegistry([
  googleRouteProvider,
  kakaoMobilityRouteProvider,
  kakaoMapsRouteProvider,
  ekispertRouteProvider,
  navitimeRouteProvider,
  otpRouteProvider,
  mockRouteProvider,
]);
const routeProviderResolver = new DefaultRouteProviderResolver({
  registry: routeProviders,
  allowOverride: config.routeProviderOverrideEnabled,
  japanTransitProvider: config.japanTransitProvider,
  ...(config.routeProvider === 'auto'
    ? {}
    : { fixedProvider: config.routeProvider }),
});
const routeResolver = new RouteResolver({
  cache: routeCache,
  cachePolicy: createRouteCachePolicy(config.routeCacheTtlSeconds),
  providers: routeProviders,
  providerResolver: routeProviderResolver,
  providerTimeoutMs: config.routeProviderTimeoutMs,
  routeTimeZone: config.routeTimeZone,
});
const analyticsWarningLogger: {
  log?: (error: unknown, event: string, jobId: string) => void;
} = {};
const routeRunner = new RouteJobRunner({
  store: routeJobStore,
  events: routeEvents,
  resolver: routeResolver,
  ...(routeAnalyticsRecorder ? { analytics: routeAnalyticsRecorder } : {}),
  routeTimeZone: config.routeTimeZone,
  exposeRawProviderResponse: config.routeProviderRawDebugEnabled,
  onAnalyticsError: (error, event, job) => {
    analyticsWarningLogger.log?.(error, event, job.jobId);
  },
});
const routeJobs = new RouteJobService(routeJobStore, routeEvents, routeRunner);
const matrixJobStore = new RedisMatrixJobStore(
  redis,
  config.routeJobTtlSeconds,
);
const matrixEvents = new InMemoryMatrixJobEventBus();
const matrixRunner = new MatrixJobRunner({
  store: matrixJobStore,
  events: matrixEvents,
  resolver: routeResolver,
  concurrency: config.routeMatrixConcurrency,
});
const matrixJobs = new MatrixJobService(
  matrixJobStore,
  matrixEvents,
  matrixRunner,
);
const aiJobStore = new RedisAiJobStore(redis, config.aiJobTtlSeconds);
const aiEvents = new InMemoryAiJobEventBus();
const aiCache = new RedisAiCacheRepository(redis);
const aiProviders = new AiProviderRegistry([
  new GeminiAiProvider(config.geminiApiKey),
  new OpenWebUIAiProvider(config.openWebUIBaseUrl, config.openWebUIApiKey),
  new MockAiProvider(),
]);
const openWebUIModels = new OpenWebUIModelService(
  config.openWebUIBaseUrl,
  config.openWebUIApiKey,
  config.aiProviderTimeoutMs,
);
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
  getPostgresStatus: async () => postgres.getStatus(),
  logger: true,
  routeCache: {
    jobs: routeJobs,
    events: routeEvents,
    cacheInspector: routeCacheInspector,
    googleProviderDebug: {
      provider: googleRouteProvider,
      timeoutMs: config.routeProviderTimeoutMs,
      exposeRawProviderResponse: config.routeProviderRawDebugEnabled,
    },
    matrix: { jobs: matrixJobs, events: matrixEvents },
    providerCatalog: {
      registry: routeProviders,
      overrideEnabled: config.routeProviderOverrideEnabled,
      rawProviderResponseEnabled: config.routeProviderRawDebugEnabled,
    },
    ...(routeAnalyticsRepository
      ? { analytics: routeAnalyticsRepository }
      : {}),
  },
  aiCache: {
    jobs: aiJobs,
    events: aiEvents,
    requestDefaults: {
      provider: config.aiProvider,
      models: {
        gemini: config.geminiModel,
        openwebui: config.openWebUIModel,
        mock: 'mock-ai-v1',
      },
    },
    openWebUIModels,
  },
});

analyticsWarningLogger.log = (error, event, jobId) => {
  app.log.warn(
    { err: error, analyticsEvent: event, jobId },
    'Failed to record Route analytics',
  );
};

redis.on('error', (error) => {
  app.log.error({ error }, 'Redis connection error');
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  await app.close();

  if (redis.isOpen) {
    await redis.quit();
  }
  postgres.stop();
  await closeDatabasePool(database);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await redis.connect();
  if (!database && config.nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  if (database) {
    const migrations = await runMigrations(database);
    app.log.info(
      {
        appliedMigrations: migrations.applied,
        existingMigrationCount: migrations.alreadyApplied.length,
      },
      'PostgreSQL migrations complete',
    );
  }
  const postgresStatus = await postgres.start();
  if (postgresStatus === 'error') {
    app.log.warn(
      'PostgreSQL is not configured or unavailable; /status will report an error',
    );
  }
  const resumedJobs = await routeJobs.resumePending();
  if (resumedJobs) app.log.info({ resumedJobs }, 'Resumed pending Route Jobs');
  const resumedMatrixJobs = await matrixJobs.resumePending();
  if (resumedMatrixJobs) {
    app.log.info({ resumedMatrixJobs }, 'Resumed pending Matrix Jobs');
  }
  const resumedAiJobs = await aiJobs.resumePending();
  if (resumedAiJobs) app.log.info({ resumedAiJobs }, 'Resumed pending AI Jobs');
  if (
    (config.routeProvider === 'auto' || config.routeProvider === 'google') &&
    !config.googleMapsApiKey
  ) {
    app.log.warn(
      'Google route provider is enabled but GOOGLE_MAPS_API_KEY is not set; Google Route Jobs will fail',
    );
  } else if (config.routeProvider === 'mock') {
    app.log.warn('Using the mock route provider');
  }
  if (
    (config.routeProvider === 'otp' ||
      (config.routeProvider === 'auto' &&
        config.japanTransitProvider === 'otp')) &&
    !config.otpProviderEnabled
  ) {
    app.log.warn(
      'OTP route provider is selected but OTP_PROVIDER_ENABLED is false; JP transit Route Jobs will fail without fallback',
    );
  }
  if (
    (config.routeProvider === 'navitime' ||
      (config.routeProvider === 'auto' &&
        config.japanTransitProvider === 'navitime')) &&
    !config.navitimeApiKey
  ) {
    app.log.warn(
      'NAVITIME route provider is enabled but NAVITIME_API_KEY is not set; JP transit Route Jobs will fail',
    );
  }
  if (
    (config.routeProvider === 'ekispert' ||
      (config.routeProvider === 'auto' &&
        config.japanTransitProvider === 'ekispert')) &&
    !config.ekispertApiKey
  ) {
    app.log.warn(
      'Ekispert route provider is selected but EKISPERT_API_KEY is not set; JP transit Route Jobs will fail without fallback',
    );
  }
  if (
    (config.routeProvider === 'auto' ||
      config.routeProvider === 'kakao-mobility') &&
    !config.kakaoMobilityApiKey
  ) {
    app.log.warn(
      'Kakao Mobility route provider is enabled but KAKAO_MOBILITY_API_KEY is not set; KR driving Route Jobs will fail',
    );
  }
  if (
    (config.routeProvider === 'auto' ||
      config.routeProvider === 'kakao-maps') &&
    !config.kakaoRestApiKey
  ) {
    app.log.warn(
      'Kakao Maps route provider is enabled but KAKAO_REST_API_KEY is not set; KR transit, walking, and bicycle Route Jobs will fail',
    );
  }
  if (config.aiProvider === 'gemini' && !config.geminiApiKey) {
    app.log.warn(
      'AI_PROVIDER is gemini but GEMINI_API_KEY is not set; AI Jobs will fail',
    );
  } else if (
    config.aiProvider === 'openwebui' &&
    (!config.openWebUIBaseUrl || !config.openWebUIModel)
  ) {
    app.log.warn(
      'AI_PROVIDER is openwebui but OPENWEBUI_BASE_URL or OPENWEBUI_MODEL is not set; default AI Jobs will fail',
    );
  } else if (config.aiProvider === 'mock') {
    app.log.warn('Using the mock AI provider');
  }
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  postgres.stop();
  await closeDatabasePool(database).catch(() => undefined);
  if (redis.isOpen) await redis.quit().catch(() => undefined);
  process.exitCode = 1;
}
