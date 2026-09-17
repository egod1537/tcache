export interface AppConfig {
  nodeEnv: string;
  port: number;
  redisUrl: string;
  gitCommitSha: string;
  routeJobTtlSeconds: number;
  routeCacheTtlSeconds: number;
  routeProviderTimeoutMs: number;
  routeProvider: 'google' | 'mock';
  googleMapsApiKey: string;
  aiJobTtlSeconds: number;
  aiCacheTtlSeconds: number;
  aiProviderTimeoutMs: number;
  aiProvider: 'gemini' | 'openwebui' | 'mock';
  geminiApiKey: string;
  geminiModel: string;
  openWebUIBaseUrl: string;
  openWebUIApiKey: string;
  openWebUIModel: string;
}

function readPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid ${name}: ${value ?? ''}`);
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const routeProvider =
    env.ROUTE_PROVIDER?.trim().toLowerCase() ??
    (nodeEnv === 'production' ? 'google' : 'mock');
  if (routeProvider !== 'google' && routeProvider !== 'mock') {
    throw new Error(`Invalid ROUTE_PROVIDER: ${routeProvider}`);
  }
  const aiProvider =
    env.AI_PROVIDER?.trim().toLowerCase() ??
    (nodeEnv === 'production' ? 'gemini' : 'mock');
  if (
    aiProvider !== 'gemini' &&
    aiProvider !== 'openwebui' &&
    aiProvider !== 'mock'
  ) {
    throw new Error(`Invalid AI_PROVIDER: ${aiProvider}`);
  }

  return {
    nodeEnv,
    port: readPositiveInteger('TCACHE_PORT', env.TCACHE_PORT, 3200, 65_535),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    gitCommitSha: env.GIT_COMMIT_SHA ?? 'dev',
    routeJobTtlSeconds: readPositiveInteger(
      'ROUTE_JOB_TTL_SECONDS',
      env.ROUTE_JOB_TTL_SECONDS,
      86_400,
    ),
    routeCacheTtlSeconds: readPositiveInteger(
      'ROUTE_CACHE_TTL_SECONDS',
      env.ROUTE_CACHE_TTL_SECONDS,
      3_600,
    ),
    routeProviderTimeoutMs: readPositiveInteger(
      'ROUTE_PROVIDER_TIMEOUT_MS',
      env.ROUTE_PROVIDER_TIMEOUT_MS,
      30_000,
    ),
    routeProvider,
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
    aiJobTtlSeconds: readPositiveInteger(
      'AI_JOB_TTL_SECONDS',
      env.AI_JOB_TTL_SECONDS,
      86_400,
    ),
    aiCacheTtlSeconds: readPositiveInteger(
      'AI_CACHE_DEFAULT_TTL_SECONDS',
      env.AI_CACHE_DEFAULT_TTL_SECONDS,
      3_600,
    ),
    aiProviderTimeoutMs: readPositiveInteger(
      'AI_PROVIDER_TIMEOUT_MS',
      env.AI_PROVIDER_TIMEOUT_MS,
      120_000,
    ),
    aiProvider,
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? '',
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    openWebUIBaseUrl: env.OPENWEBUI_BASE_URL?.trim() ?? '',
    openWebUIApiKey: env.OPENWEBUI_API_KEY?.trim() ?? '',
    openWebUIModel: env.OPENWEBUI_MODEL?.trim() ?? '',
  };
}
