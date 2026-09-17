import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('tcache server', () => {
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
    });
    expect(response.json().uptime).toEqual(expect.any(Number));
  });
});
