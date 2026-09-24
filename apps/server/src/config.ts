import { DEFAULT_EKISPERT_API_BASE_URL } from '../../../route/server/providers/ekispert/mapper.js';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  redisUrl: string;
  databaseUrl: string;
  gitCommitSha: string;
  routeJobTtlSeconds: number;
  routeCacheTtlSeconds: number;
  routeProviderTimeoutMs: number;
  routeMatrixConcurrency: number;
  routeProvider:
    | 'auto'
    | 'google'
    | 'kakao-mobility'
    | 'kakao-maps'
    | 'ekispert'
    | 'navitime'
    | 'otp'
    | 'mock';
  japanTransitProvider: 'ekispert' | 'navitime' | 'otp';
  routeProviderOverrideEnabled: boolean;
  routeProviderRawDebugEnabled: boolean;
  routeTimeZone: string;
  googleMapsApiKey: string;
  kakaoRestApiKey: string;
  kakaoMobilityApiKey: string;
  navitimeApiKey: string;
  navitimeApiBaseUrl: string;
  ekispertApiKey: string;
  ekispertApiBaseUrl: string;
  otpBaseUrl: string;
  otpProviderEnabled: boolean;
  otpRequestTimeoutMs: number;
  otpVersion: string;
  otpGraphBuildId: string;
  otpGtfsDatasetVersion: string;
  otpOsmDatasetVersion: string;
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

function readTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || 'Asia/Seoul';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new Error(`Invalid ROUTE_TIME_ZONE: ${timeZone}`);
  }
  return timeZone;
}

function readBoolean(
  name: string,
  value: string | undefined,
  fallback: boolean,
) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid ${name}: ${value}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const routeProvider =
    env.ROUTE_PROVIDER?.trim().toLowerCase() ??
    (nodeEnv === 'production' ? 'auto' : 'mock');
  if (
    routeProvider !== 'auto' &&
    routeProvider !== 'google' &&
    routeProvider !== 'kakao-mobility' &&
    routeProvider !== 'kakao-maps' &&
    routeProvider !== 'ekispert' &&
    routeProvider !== 'navitime' &&
    routeProvider !== 'otp' &&
    routeProvider !== 'mock'
  ) {
    throw new Error(`Invalid ROUTE_PROVIDER: ${routeProvider}`);
  }
  const japanTransitProvider =
    env.JAPAN_TRANSIT_PROVIDER?.trim().toLowerCase() ?? 'ekispert';
  if (
    japanTransitProvider !== 'ekispert' &&
    japanTransitProvider !== 'navitime' &&
    japanTransitProvider !== 'otp'
  ) {
    throw new Error(`Invalid JAPAN_TRANSIT_PROVIDER: ${japanTransitProvider}`);
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
    databaseUrl: env.DATABASE_URL?.trim() ?? '',
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
    routeMatrixConcurrency: readPositiveInteger(
      'TCACHE_MATRIX_CONCURRENCY',
      env.TCACHE_MATRIX_CONCURRENCY,
      4,
    ),
    routeProvider,
    japanTransitProvider,
    routeProviderOverrideEnabled: readBoolean(
      'ROUTE_PROVIDER_OVERRIDE_ENABLED',
      env.ROUTE_PROVIDER_OVERRIDE_ENABLED,
      nodeEnv !== 'production',
    ),
    routeProviderRawDebugEnabled: readBoolean(
      'ROUTE_PROVIDER_RAW_DEBUG_ENABLED',
      env.ROUTE_PROVIDER_RAW_DEBUG_ENABLED,
      nodeEnv !== 'production',
    ),
    routeTimeZone: readTimeZone(env.ROUTE_TIME_ZONE),
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
    kakaoRestApiKey: env.KAKAO_REST_API_KEY?.trim() ?? '',
    kakaoMobilityApiKey: env.KAKAO_MOBILITY_API_KEY?.trim() ?? '',
    navitimeApiKey: env.NAVITIME_API_KEY?.trim() ?? '',
    navitimeApiBaseUrl:
      env.NAVITIME_API_BASE_URL?.trim() ||
      'https://navitime-route-totalnavi.p.rapidapi.com',
    ekispertApiKey: env.EKISPERT_API_KEY?.trim() ?? '',
    ekispertApiBaseUrl:
      env.EKISPERT_API_BASE_URL?.trim() || DEFAULT_EKISPERT_API_BASE_URL,
    otpBaseUrl: env.OTP_BASE_URL?.trim() || 'http://localhost:8080',
    otpProviderEnabled: readBoolean(
      'OTP_PROVIDER_ENABLED',
      env.OTP_PROVIDER_ENABLED,
      false,
    ),
    otpRequestTimeoutMs: readPositiveInteger(
      'OTP_REQUEST_TIMEOUT_MS',
      env.OTP_REQUEST_TIMEOUT_MS,
      30_000,
    ),
    otpVersion: env.OTP_VERSION?.trim() ?? '',
    otpGraphBuildId: env.OTP_GRAPH_BUILD_ID?.trim() ?? '',
    otpGtfsDatasetVersion: env.OTP_GTFS_DATASET_VERSION?.trim() ?? '',
    otpOsmDatasetVersion: env.OTP_OSM_DATASET_VERSION?.trim() ?? '',
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
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash',
    openWebUIBaseUrl: env.OPENWEBUI_BASE_URL?.trim() ?? '',
    openWebUIApiKey: env.OPENWEBUI_API_KEY?.trim() ?? '',
    openWebUIModel: env.OPENWEBUI_MODEL?.trim() ?? '',
  };
}
