import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from '../../../apps/server/src/db/client.js';
import { PostgresRouteAnalyticsRepository } from './repository.js';
import type {
  RouteAnalyticsFinishedRecord,
  RouteAnalyticsStartedRecord,
} from './types.js';

const startedRecord: RouteAnalyticsStartedRecord = {
  createdAt: new Date('2026-09-17T05:20:00.000Z'),
  jobId: 'route_analytics_test',
  fromKey: 'place:origin',
  toKey: 'coord:35.68124,139.76712',
  mode: 'TRANSIT',
  dayType: 'weekday',
  timeBucket: '14:20',
  provider: 'google',
  countryCode: 'JP',
  providerSelectionSource: 'country-mode',
  cacheKey: 'route:v4:test',
  requestVersion: 1,
};

const finishedRecord: RouteAnalyticsFinishedRecord = {
  ...startedRecord,
  completedAt: new Date('2026-09-17T05:20:01.200Z'),
  cacheHit: false,
  totalLatencyMs: 1_200,
  providerLatencyMs: 800,
  status: 'completed',
  errorCode: null,
};

function createRepository() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  return {
    query,
    repository: new PostgresRouteAnalyticsRepository({
      query,
    } as unknown as DatabaseQueryable),
  };
}

describe('PostgresRouteAnalyticsRepository', () => {
  it('upserts started metadata without allowing it to overwrite terminal status', async () => {
    const { query, repository } = createRepository();

    await repository.started(startedRecord);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'queued'");
    expect(sql).toContain('ON CONFLICT (job_id) DO UPDATE');
    expect(sql).toContain('provider_selection_source');
    expect(sql).not.toContain('status = EXCLUDED.status');
    expect(sql).not.toContain(startedRecord.jobId);
    expect(values).toContain(startedRecord.jobId);
    expect(values).toContain('country-mode');
  });

  it('upserts terminal cache and latency metadata', async () => {
    const { query, repository } = createRepository();

    await repository.finished(finishedRecord);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('cache_hit = EXCLUDED.cache_hit');
    expect(sql).toContain('provider_latency_ms = EXCLUDED.provider_latency_ms');
    expect(sql).toContain('status = EXCLUDED.status');
    expect(values).toContain(1_200);
    expect(values).toContain(800);
    expect(values).toContain('completed');
  });

  it('rejects invalid ten-minute buckets before querying PostgreSQL', async () => {
    const { query, repository } = createRepository();

    await expect(
      repository.started({ ...startedRecord, timeBucket: '14:27' }),
    ).rejects.toThrow('Invalid route analytics time bucket');
    expect(query).not.toHaveBeenCalled();
  });

  it('aggregates summary and hit rate in PostgreSQL with period and filters', async () => {
    const { query, repository } = createRepository();
    query.mockResolvedValueOnce({
      rows: [
        {
          requests: 10,
          cache_hits: 7,
          cache_misses: 2,
          cache_hit_rate: 7 / 9,
          provider_calls: 2,
          avg_latency_ms: 382.4,
          error_rate: 0.1,
        },
      ],
    });
    const filter = {
      from: new Date('2026-09-16T00:00:00.000Z'),
      to: new Date('2026-09-17T00:00:00.000Z'),
      mode: 'TRANSIT' as const,
      provider: 'google',
      status: 'completed' as const,
    };

    await expect(repository.summary(filter)).resolves.toEqual({
      requests: 10,
      cacheHits: 7,
      cacheMisses: 2,
      cacheHitRate: 7 / 9,
      providerCalls: 2,
      avgLatencyMs: 382,
      errorRate: 0.1,
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql.trimStart()).toMatch(/^SELECT/);
    expect(sql).toContain('mode = $3');
    expect(sql).toContain('provider = $4');
    expect(sql).toContain('status = $5');
    expect(values).toEqual([
      filter.from,
      filter.to,
      'TRANSIT',
      'google',
      'completed',
    ]);
  });

  it('returns an empty summary without NaN rates', async () => {
    const { query, repository } = createRepository();
    query.mockResolvedValueOnce({
      rows: [
        {
          requests: 0,
          cache_hits: 0,
          cache_misses: 0,
          cache_hit_rate: 0,
          provider_calls: 0,
          avg_latency_ms: 0,
          error_rate: 0,
        },
      ],
    });

    await expect(
      repository.summary({
        from: new Date('2026-09-16T00:00:00.000Z'),
        to: new Date('2026-09-17T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      providerCalls: 0,
      avgLatencyMs: 0,
      errorRate: 0,
    });
  });

  it('groups timeseries in PostgreSQL and returns all mode buckets', async () => {
    const { query, repository } = createRepository();
    const filter = {
      from: new Date('2026-09-16T00:00:00.000Z'),
      to: new Date('2026-09-17T00:00:00.000Z'),
    };
    query.mockResolvedValueOnce({
      rows: [
        {
          time: new Date('2026-09-16T12:00:00.000Z'),
          requests: 5,
          cache_hits: 3,
          cache_misses: 2,
        },
      ],
    });
    await expect(repository.timeseries(filter, 'hour')).resolves.toEqual([
      {
        time: '2026-09-16T12:00:00.000Z',
        requests: 5,
        cacheHits: 3,
        cacheMisses: 2,
      },
    ]);
    expect((query.mock.calls[0] as [string])[0]).toContain('GROUP BY time');
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toContain('hour');

    query.mockResolvedValueOnce({
      rows: [{ mode: 'DRIVING', requests: 4, cache_hit_rate: 0.75 }],
    });
    const modes = await repository.modes(filter);
    expect(modes).toEqual([
      { mode: 'TRANSIT', requests: 0, cacheHitRate: 0 },
      { mode: 'WALKING', requests: 0, cacheHitRate: 0 },
      { mode: 'DRIVING', requests: 4, cacheHitRate: 0.75 },
      { mode: 'BICYCLING', requests: 0, cacheHitRate: 0 },
    ]);
  });

  it('returns top routes, grouped errors, and recent metadata only', async () => {
    const { query, repository } = createRepository();
    const filter = {
      from: new Date('2026-09-16T00:00:00.000Z'),
      to: new Date('2026-09-17T00:00:00.000Z'),
    };
    query.mockResolvedValueOnce({
      rows: [
        {
          from_key: 'place:A',
          to_key: 'place:B',
          mode: 'DRIVING',
          requests: 12,
          cache_hit_rate: 0.8,
          avg_latency_ms: 250.2,
        },
      ],
    });
    await expect(repository.topRoutes(filter, 10)).resolves.toEqual([
      {
        fromKey: 'place:A',
        toKey: 'place:B',
        mode: 'DRIVING',
        requests: 12,
        cacheHitRate: 0.8,
        avgLatencyMs: 250,
      },
    ]);

    query.mockResolvedValueOnce({
      rows: [{ error_code: 'GOOGLE_ROUTES_ERROR', count: 3 }],
    });
    await expect(repository.errors(filter)).resolves.toEqual([
      { errorCode: 'GOOGLE_ROUTES_ERROR', count: 3 },
    ]);

    query.mockResolvedValueOnce({
      rows: [
        {
          created_at: new Date('2026-09-16T12:00:00.000Z'),
          job_id: 'route_1',
          from_key: 'place:A',
          to_key: 'place:B',
          mode: 'DRIVING',
          provider: 'google',
          cache_hit: false,
          total_latency_ms: 420,
          status: 'failed',
          error_code: 'GOOGLE_ROUTES_ERROR',
        },
      ],
    });
    await expect(repository.recent(filter, 25)).resolves.toEqual([
      {
        createdAt: '2026-09-16T12:00:00.000Z',
        jobId: 'route_1',
        fromKey: 'place:A',
        toKey: 'place:B',
        mode: 'DRIVING',
        provider: 'google',
        cacheHit: false,
        latency: 420,
        status: 'failed',
        errorCode: 'GOOGLE_ROUTES_ERROR',
      },
    ]);
    const allSql = query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(allSql).not.toMatch(/upstream|message/i);
  });
});
