import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import type { RouteApiContext } from './api/context.js';
import type { RouteCacheInspector } from './cache/inspector.js';

const apps: ReturnType<typeof buildApp>[] = [];

function createApp(inspector: RouteCacheInspector) {
  const context = {
    jobs: {},
    events: {},
    cacheInspector: inspector,
  } as RouteApiContext;
  const app = buildApp({ routeCache: context });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Route Cache Explorer API', () => {
  it('lists bounded cache metadata without returning entry bodies', async () => {
    const inspector: RouteCacheInspector = {
      list: vi.fn().mockResolvedValue([
        {
          key: 'v1:google:abc',
          provider: 'google',
          providerVersion: '1',
          normalizedRequestHash: 'request-hash',
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-09-24T01:00:00.000Z',
          ttlSeconds: 120,
          sizeBytes: 512,
        },
      ]),
      get: vi.fn(),
    };
    const response = await createApp(inspector).inject({
      method: 'GET',
      url: '/api/route/cache?limit=25',
    });

    expect(response.statusCode).toBe(200);
    expect(inspector.list).toHaveBeenCalledWith(25);
    expect(response.json()).toEqual({
      entries: [
        {
          key: 'v1:google:abc',
          provider: 'google',
          providerVersion: '1',
          normalizedRequestHash: 'request-hash',
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-09-24T01:00:00.000Z',
          ttlSeconds: 120,
          sizeBytes: 512,
        },
      ],
    });
  });

  it('returns a selected entry and validates read-only queries', async () => {
    const inspector: RouteCacheInspector = {
      list: vi.fn(),
      get: vi.fn().mockResolvedValue({
        key: 'v1:google:abc',
        provider: 'google',
        providerVersion: '1',
        normalizedRequestHash: 'request-hash',
        createdAt: '2026-09-24T00:00:00.000Z',
        expiresAt: '2026-09-24T01:00:00.000Z',
        ttlSeconds: 120,
        sizeBytes: 512,
        value: {
          provider: 'google',
          result: { routes: [] },
          metadata: {
            provider: 'google',
            providerVersion: '1',
            normalizedRequestHash: 'request-hash',
            createdAt: '2026-09-24T00:00:00.000Z',
            expiresAt: '2026-09-24T01:00:00.000Z',
          },
        },
      }),
    };
    const app = createApp(inspector);
    const entry = await app.inject({
      method: 'GET',
      url: '/api/route/cache/entry?key=v1%3Agoogle%3Aabc',
    });
    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/route/cache?limit=1000',
    });

    expect(entry.statusCode).toBe(200);
    expect(inspector.get).toHaveBeenCalledWith('v1:google:abc');
    expect(entry.json()).toMatchObject({
      key: 'v1:google:abc',
      value: { provider: 'google' },
    });
    expect(invalidLimit.statusCode).toBe(400);
  });

  it('returns 404 for an expired entry', async () => {
    const inspector: RouteCacheInspector = {
      list: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
    };
    const response = await createApp(inspector).inject({
      method: 'GET',
      url: '/api/route/cache/entry?key=expired',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'CACHE_ENTRY_NOT_FOUND' },
    });
  });
});
