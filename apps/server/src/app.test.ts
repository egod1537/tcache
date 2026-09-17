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
