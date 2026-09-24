import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import { createRouteCachePolicy } from './cache/policy.js';
import type { CachedRoute, RouteCacheRepository } from './cache/repository.js';
import { InMemoryRouteJobEventBus } from './jobs/route-job-events.js';
import type { RouteJob } from './jobs/route-job.js';
import type { RouteJobStore } from './jobs/route-job-store.js';
import { RouteJobRunner } from './jobs/route-job-runner.js';
import { RouteJobService } from './jobs/route-job-service.js';
import { InMemoryMatrixJobEventBus } from './matrix/matrix-job-events.js';
import { MatrixJobRunner } from './matrix/matrix-job-runner.js';
import { MatrixJobService } from './matrix/matrix-job-service.js';
import type { MatrixJobStore } from './matrix/matrix-job-store.js';
import type { MatrixJob } from './matrix/matrix-job.js';
import type {
  RouteProvider,
  RouteProviderResult,
} from './providers/provider.js';
import { RouteResolver } from './resolver/route-resolver.js';
import type { NormalizedRouteRequest } from './types/route.js';

class MemoryMatrixStore implements MatrixJobStore {
  jobs = new Map<string, MatrixJob>();
  async save(job: MatrixJob) {
    this.jobs.set(job.jobId, structuredClone(job));
  }
  async get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }
  async list(limit: number) {
    return [...this.jobs.values()].slice(0, limit).map(structuredClone);
  }
}

class MemoryRouteStore implements RouteJobStore {
  async save(job: RouteJob) {
    void job;
  }
  async get(jobId: string) {
    void jobId;
    return null;
  }
  async list(limit: number) {
    void limit;
    return [];
  }
}

class MemoryCache implements RouteCacheRepository {
  values = new Map<string, CachedRoute>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: CachedRoute) {
    this.values.set(key, value);
  }
}

class MatrixProvider implements RouteProvider {
  readonly providerName = 'matrix-test';
  calls = 0;
  active = 0;
  maxActive = 0;

  constructor(
    private readonly delayMs = 0,
    private readonly failOrigin?: string,
  ) {}

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (request.origin.externalIds?.googlePlaceId === this.failOrigin) {
        throw new Error('provider failed');
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
      const from = request.origin.externalIds?.googlePlaceId
        ? request.origin.externalIds.googlePlaceId.charCodeAt(0) - 64
        : 0;
      const to = request.destination.externalIds?.googlePlaceId
        ? request.destination.externalIds.googlePlaceId.charCodeAt(0) - 64
        : 0;
      return {
        provider: this.providerName,
        result: { routes: [{ durationSeconds: from * 100 + to }] },
      };
    } finally {
      this.active -= 1;
    }
  }
}

const apps: ReturnType<typeof buildApp>[] = [];
const request = (ids = ['A', 'B', 'C']) => ({
  locations: ids.map((id) => ({ id, placeId: id })),
  mode: 'TRANSIT',
  departureTime: '2026-10-01T09:00:00+09:00',
  options: { languageCode: 'ja', regionCode: 'JP' },
});

function createApp(provider: RouteProvider, concurrency = 2) {
  const cache = new MemoryCache();
  const resolver = new RouteResolver({
    cache,
    cachePolicy: createRouteCachePolicy(3_600),
    provider,
    providerTimeoutMs: 1_000,
  });
  const store = new MemoryMatrixStore();
  const events = new InMemoryMatrixJobEventBus();
  const runner = new MatrixJobRunner({
    store,
    events,
    resolver,
    concurrency,
  });
  const jobs = new MatrixJobService(store, events, runner);
  const routeEvents = new InMemoryRouteJobEventBus();
  const routeJobs = new RouteJobService(
    new MemoryRouteStore(),
    routeEvents,
    new RouteJobRunner({
      store: new MemoryRouteStore(),
      events: routeEvents,
      resolver,
    }),
  );
  const app = buildApp({
    routeCache: {
      jobs: routeJobs,
      events: routeEvents,
      matrix: { jobs, events },
    },
  });
  apps.push(app);
  return { app, jobs };
}

async function createAndWait(
  app: ReturnType<typeof buildApp>,
  payload: unknown,
) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/route/matrix/jobs',
    payload,
  });
  const jobId = created.json<{ jobId: string }>().jobId;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await app.inject({
      method: 'GET',
      url: `/api/route/matrix/jobs/${jobId}`,
    });
    const job = status.json<MatrixJob>();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return { created, job };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Matrix job did not finish');
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('matrix jobs', () => {
  it.each([
    [2, 2],
    [3, 6],
  ])('builds %i locations as %i directed pairs', async (size, pairs) => {
    const { app } = createApp(new MatrixProvider());
    const ids = ['A', 'B', 'C'].slice(0, size);
    const { created, job } = await createAndWait(app, request(ids));
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      jobId: expect.stringMatching(/^route-matrix-/),
      statusUrl: expect.stringContaining('/matrix/jobs/'),
    });
    expect(job).toMatchObject({
      status: 'completed',
      stats: { totalPairs: pairs, completedPairs: pairs },
    });
    const result = await app.inject({
      method: 'GET',
      url: `/api/route/matrix/jobs/${job.jobId}/result`,
    });
    const body = result.json<{
      locations: { id: string }[];
      durationSeconds: number[][];
    }>();
    expect(body.locations.map(({ id }) => id)).toEqual(ids);
    expect(body.durationSeconds.map((row, index) => row[index])).toEqual(
      Array(size).fill(0),
    );
    if (size === 3) {
      expect(body.durationSeconds).toEqual([
        [0, 102, 103],
        [201, 0, 203],
        [301, 302, 0],
      ]);
    }
  });

  it('reuses route cache and reports hit/miss/provider statistics', async () => {
    const provider = new MatrixProvider();
    const { app } = createApp(provider);
    const first = await createAndWait(app, request());
    const second = await createAndWait(app, request());
    expect(first.job.stats).toMatchObject({
      cacheHits: 0,
      cacheMisses: 6,
      providerCalls: 6,
    });
    expect(second.job.stats).toMatchObject({
      cacheHits: 6,
      cacheMisses: 0,
      providerCalls: 0,
    });
    expect(provider.calls).toBe(6);
  });

  it('fails the entire job when one pair fails', async () => {
    const { app } = createApp(new MatrixProvider(0, 'B'));
    const { job } = await createAndWait(app, request());
    expect(job).toMatchObject({
      status: 'failed',
      error: {
        code: 'PAIR_ROUTE_FAILED',
        details: { fromId: 'B' },
      },
    });
  });

  it('limits concurrency and cancels active provider work', async () => {
    const provider = new MatrixProvider(50);
    const { app } = createApp(provider, 2);
    const created = await app.inject({
      method: 'POST',
      url: '/api/route/matrix/jobs',
      payload: request(),
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/route/matrix/jobs/${jobId}/cancel`,
    });
    expect(cancelled.json()).toEqual({ jobId, status: 'cancelled' });
    expect(provider.maxActive).toBeLessThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await app.inject({
      method: 'GET',
      url: `/api/route/matrix/jobs/${jobId}`,
    });
    expect(status.json()).toMatchObject({ status: 'cancelled' });
  });

  it.each([
    [{ ...request(), locations: [{ id: 'A', placeId: 'A' }] }, 'locations'],
    [{ ...request(), departureTime: 'not-a-date' }, 'departureTime'],
    [
      request(Array.from({ length: 21 }, (_, index) => `P${index}`)),
      'locations',
    ],
    [
      {
        ...request(),
        locations: [
          { id: 'A', placeId: 'A' },
          { id: 'B', latitude: 999, longitude: 1 },
        ],
      },
      'latitude',
    ],
  ])('rejects invalid matrix requests', async (payload, message) => {
    const { app } = createApp(new MatrixProvider());
    const response = await app.inject({
      method: 'POST',
      url: '/api/route/matrix/jobs',
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_MATRIX_REQUEST' },
    });
    expect(response.body).toContain(message);
  });

  it('returns 409 before completion and 404 for unknown jobs', async () => {
    const { app } = createApp(new MatrixProvider(100));
    const created = await app.inject({
      method: 'POST',
      url: '/api/route/matrix/jobs',
      payload: request(),
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    const early = await app.inject({
      method: 'GET',
      url: `/api/route/matrix/jobs/${jobId}/result`,
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({
      error: { code: 'JOB_NOT_COMPLETED' },
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/route/matrix/jobs/missing',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('emits a terminal SSE event', async () => {
    const { app } = createApp(new MatrixProvider());
    const { job } = await createAndWait(app, request(['A', 'B']));
    const events = await app.inject({
      method: 'GET',
      url: `/api/route/matrix/jobs/${job.jobId}/events`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('event: completed');
    expect(events.body).toContain('"type":"completed"');
  });
});
