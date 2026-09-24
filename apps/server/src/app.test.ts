import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('tcache server', () => {
  it('loads OpenWebUI provider and model configuration', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        AI_PROVIDER: 'openwebui',
        OPENWEBUI_BASE_URL: 'http://host.docker.internal:3000/',
        OPENWEBUI_API_KEY: '',
        OPENWEBUI_MODEL: 'qwen3.5:9b',
        GEMINI_MODEL: 'gemini-test',
        DATABASE_URL: 'postgresql://localhost:5432/tcache',
        ROUTE_TIME_ZONE: 'Asia/Tokyo',
      }),
    ).toMatchObject({
      aiProvider: 'openwebui',
      geminiModel: 'gemini-test',
      openWebUIBaseUrl: 'http://host.docker.internal:3000/',
      openWebUIApiKey: '',
      openWebUIModel: 'qwen3.5:9b',
      databaseUrl: 'postgresql://localhost:5432/tcache',
      routeTimeZone: 'Asia/Tokyo',
    });
  });

  it('rejects an invalid Route timezone', () => {
    expect(() => loadConfig({ ROUTE_TIME_ZONE: 'Mars/Olympus' })).toThrow(
      'Invalid ROUTE_TIME_ZONE',
    );
  });

  it('validates matrix concurrency as a positive integer', () => {
    expect(loadConfig({ TCACHE_MATRIX_CONCURRENCY: '7' })).toMatchObject({
      routeMatrixConcurrency: 7,
    });
    expect(() => loadConfig({ TCACHE_MATRIX_CONCURRENCY: '0' })).toThrow(
      'Invalid TCACHE_MATRIX_CONCURRENCY',
    );
  });

  it('defaults production routing to auto and disables request overrides', () => {
    expect(loadConfig({ NODE_ENV: 'production' })).toMatchObject({
      routeProvider: 'auto',
      japanTransitProvider: 'ekispert',
      routeProviderOverrideEnabled: false,
      routeProviderRawDebugEnabled: false,
    });
    expect(
      loadConfig({
        NODE_ENV: 'production',
        ROUTE_PROVIDER_OVERRIDE_ENABLED: 'true',
      }),
    ).toMatchObject({ routeProviderOverrideEnabled: true });
    expect(() =>
      loadConfig({ ROUTE_PROVIDER_OVERRIDE_ENABLED: 'sometimes' }),
    ).toThrow('Invalid ROUTE_PROVIDER_OVERRIDE_ENABLED');
    expect(
      loadConfig({ ROUTE_PROVIDER_RAW_DEBUG_ENABLED: 'true' }),
    ).toMatchObject({ routeProviderRawDebugEnabled: true });
  });

  it('loads Kakao provider keys without exposing defaults', () => {
    expect(
      loadConfig({
        KAKAO_REST_API_KEY: ' rest-key ',
        KAKAO_MOBILITY_API_KEY: ' mobility-key ',
        ROUTE_PROVIDER: 'kakao-mobility',
      }),
    ).toMatchObject({
      routeProvider: 'kakao-mobility',
      kakaoRestApiKey: 'rest-key',
      kakaoMobilityApiKey: 'mobility-key',
    });
  });

  it('loads NAVITIME provider configuration', () => {
    expect(
      loadConfig({
        NAVITIME_API_KEY: ' navitime-key ',
        NAVITIME_API_BASE_URL: 'https://example.navitime.test/',
        ROUTE_PROVIDER: 'navitime',
      }),
    ).toMatchObject({
      routeProvider: 'navitime',
      navitimeApiKey: 'navitime-key',
      navitimeApiBaseUrl: 'https://example.navitime.test/',
    });
  });

  it('loads Ekispert and Japan transit provider configuration', () => {
    expect(
      loadConfig({
        EKISPERT_API_KEY: ' trial-key ',
        EKISPERT_API_BASE_URL: 'https://ekispert.example.test/',
        ROUTE_PROVIDER: 'ekispert',
        JAPAN_TRANSIT_PROVIDER: 'navitime',
      }),
    ).toMatchObject({
      routeProvider: 'ekispert',
      japanTransitProvider: 'navitime',
      ekispertApiKey: 'trial-key',
      ekispertApiBaseUrl: 'https://ekispert.example.test/',
    });
    expect(() =>
      loadConfig({ JAPAN_TRANSIT_PROVIDER: 'silent-fallback' }),
    ).toThrow('Invalid JAPAN_TRANSIT_PROVIDER');
  });

  it('loads disabled-by-default OTP provider and dataset identity', () => {
    expect(loadConfig({})).toMatchObject({
      otpBaseUrl: 'http://localhost:8080',
      otpProviderEnabled: false,
      otpRequestTimeoutMs: 30000,
    });
    expect(
      loadConfig({
        ROUTE_PROVIDER: 'otp',
        JAPAN_TRANSIT_PROVIDER: 'otp',
        OTP_BASE_URL: 'http://otp:8080/',
        OTP_PROVIDER_ENABLED: 'true',
        OTP_REQUEST_TIMEOUT_MS: '12000',
        OTP_VERSION: '2.10.0',
        OTP_GRAPH_BUILD_ID: 'tokyo-20260924',
        OTP_GTFS_DATASET_VERSION: 'toei-202609',
        OTP_OSM_DATASET_VERSION: 'tokyo-202609',
      }),
    ).toMatchObject({
      routeProvider: 'otp',
      japanTransitProvider: 'otp',
      otpBaseUrl: 'http://otp:8080/',
      otpProviderEnabled: true,
      otpRequestTimeoutMs: 12000,
      otpVersion: '2.10.0',
      otpGraphBuildId: 'tokyo-20260924',
    });
  });

  it.each([
    ['/health', { status: 'ok' }],
    ['/api/route/ping', { system: 'route-cache', status: 'ok' }],
    ['/api/ai/ping', { system: 'ai-cache', status: 'ok' }],
  ])('GET %s returns 200', async (url, expectedBody) => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expectedBody);
  });

  it('reports deployment metadata', async () => {
    const app = buildApp({
      environment: 'test',
      version: 'abc123',
      getRedisStatus: async () => 'ok',
      getPostgresStatus: async () => 'ok',
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'tcache',
      version: 'abc123',
      environment: 'test',
      redis: 'ok',
      postgres: 'ok',
    });
    expect(response.json().uptime).toEqual(expect.any(Number));
  });
});
