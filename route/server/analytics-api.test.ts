import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import type { RouteAnalyticsReader } from './analytics/query-types.js';
import { parseRouteAnalyticsFilter } from './api/analytics.js';
import type { RouteApiContext } from './api/context.js';

const apps: ReturnType<typeof buildApp>[] = [];

function createReader(): RouteAnalyticsReader {
  return {
    summary: vi.fn().mockResolvedValue({
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      providerCalls: 0,
      avgLatencyMs: 0,
      errorRate: 0,
    }),
    timeseries: vi.fn().mockResolvedValue([]),
    modes: vi.fn().mockResolvedValue([]),
    topRoutes: vi.fn().mockResolvedValue([]),
    errors: vi.fn().mockResolvedValue([]),
    recent: vi.fn().mockResolvedValue([]),
  };
}

function createApp(reader: RouteAnalyticsReader) {
  const app = buildApp({
    routeCache: { analytics: reader } as RouteApiContext,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Route Analytics API', () => {
  it('uses an explicit 24-hour default range', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');

    expect(parseRouteAnalyticsFilter({}, now)).toEqual({
      from: new Date('2026-09-16T12:00:00.000Z'),
      to: now,
    });
  });

  it('passes period, mode, and provider filters to summary', async () => {
    const reader = createReader();
    const app = createApp(reader);
    const response = await app.inject({
      method: 'GET',
      url: '/api/route/analytics/summary?from=2026-09-01T00%3A00%3A00Z&to=2026-09-02T00%3A00%3A00Z&mode=driving&provider=google&status=completed',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requests: 0, cacheHitRate: 0 });
    expect(reader.summary).toHaveBeenCalledWith({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-02T00:00:00.000Z'),
      mode: 'DRIVING',
      provider: 'google',
      status: 'completed',
    });
  });

  it('exposes timeseries, modes, top routes, errors, and recent envelopes', async () => {
    const reader = createReader();
    vi.mocked(reader.timeseries).mockResolvedValue([
      {
        time: '2026-09-17T10:00:00.000Z',
        requests: 5,
        cacheHits: 3,
        cacheMisses: 2,
      },
    ]);
    vi.mocked(reader.modes).mockResolvedValue([
      { mode: 'DRIVING', requests: 5, cacheHitRate: 0.6 },
    ]);
    vi.mocked(reader.topRoutes).mockResolvedValue([
      {
        fromKey: 'place:A',
        toKey: 'place:B',
        mode: 'DRIVING',
        requests: 5,
        cacheHitRate: 0.6,
        avgLatencyMs: 200,
      },
    ]);
    vi.mocked(reader.errors).mockResolvedValue([
      { errorCode: 'CACHE_ERROR', count: 1 },
    ]);
    vi.mocked(reader.recent).mockResolvedValue([]);
    const app = createApp(reader);

    const [timeseries, modes, topRoutes, errors, recent] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/route/analytics/timeseries?interval=day',
      }),
      app.inject({ method: 'GET', url: '/api/route/analytics/modes' }),
      app.inject({
        method: 'GET',
        url: '/api/route/analytics/top-routes?limit=10',
      }),
      app.inject({ method: 'GET', url: '/api/route/analytics/errors' }),
      app.inject({
        method: 'GET',
        url: '/api/route/analytics/recent?limit=25',
      }),
    ]);

    expect(timeseries.json()).toHaveProperty('points');
    expect(modes.json()).toHaveProperty('modes');
    expect(topRoutes.json()).toHaveProperty('routes');
    expect(errors.json()).toHaveProperty('errors');
    expect(recent.json()).toEqual({ requests: [] });
    expect(reader.timeseries).toHaveBeenCalledWith(expect.anything(), 'day');
    expect(reader.topRoutes).toHaveBeenCalledWith(expect.anything(), 10);
    expect(reader.recent).toHaveBeenCalledWith(expect.anything(), 25);
  });

  it.each([
    [
      '/api/route/analytics/summary?from=2026-01-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z',
      '90 days',
    ],
    ['/api/route/analytics/summary?mode=FLYING', 'mode must be'],
    ['/api/route/analytics/timeseries?interval=minute', 'interval must be'],
    ['/api/route/analytics/recent?limit=201', 'limit must be'],
  ])('rejects invalid query %s', async (url, message) => {
    const app = createApp(createReader());
    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INVALID_ANALYTICS_QUERY',
        message: expect.stringContaining(message),
      },
    });
  });

  it('does not expose analytics mutation routes', async () => {
    const app = createApp(createReader());
    const response = await app.inject({
      method: 'POST',
      url: '/api/route/analytics/summary',
    });

    expect(response.statusCode).toBe(404);
  });
});
