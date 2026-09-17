import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import { createRouteCachePolicy } from './cache/policy.js';
import type { CachedRoute, RouteCacheRepository } from './cache/repository.js';
import type { RouteJob } from './jobs/route-job.js';
import { InMemoryRouteJobEventBus } from './jobs/route-job-events.js';
import { RouteJobRunner } from './jobs/route-job-runner.js';
import { RouteJobService } from './jobs/route-job-service.js';
import type { RouteJobStore } from './jobs/route-job-store.js';
import type {
  RouteProvider,
  RouteProviderResult,
} from './providers/provider.js';
import type { NormalizedRouteRequest } from './types/route.js';

class MemoryJobStore implements RouteJobStore {
  readonly jobs = new Map<string, RouteJob>();

  async save(job: RouteJob) {
    this.jobs.set(job.jobId, structuredClone(job));
  }

  async get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async list(limit: number) {
    return [...this.jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }
}

class MemoryCache implements RouteCacheRepository {
  readonly values = new Map<string, CachedRoute>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: CachedRoute) {
    this.values.set(key, value);
  }
}

class TestProvider implements RouteProvider {
  calls = 0;

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    void signal;
    this.calls += 1;
    return {
      provider: 'test',
      result: { request, route: ['origin', 'destination'] },
    };
  }
}

class BlockingProvider implements RouteProvider {
  async getRoute(
    _request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  }
}

const apps: ReturnType<typeof buildApp>[] = [];
const requestBody = {
  origin: { latitude: 37.5665, longitude: 126.978 },
  destination: { latitude: 35.1796, longitude: 129.0756 },
  waypoints: [],
  travelMode: 'TRANSIT',
  departureTime: '2026-09-17T02:00:00.000Z',
  options: { languageCode: 'ko' },
};

function createTestApp(
  provider: RouteProvider,
  providerTimeoutMs = 1_000,
  cache = new MemoryCache(),
) {
  const store = new MemoryJobStore();
  const events = new InMemoryRouteJobEventBus();
  const runner = new RouteJobRunner({
    store,
    events,
    cache,
    cachePolicy: createRouteCachePolicy(3_600),
    provider,
    providerTimeoutMs,
  });
  const jobs = new RouteJobService(store, events, runner);
  const app = buildApp({ routeCache: { jobs, events } });
  apps.push(app);
  return { app, store, cache, jobs };
}

async function waitForTerminal(
  app: ReturnType<typeof buildApp>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/route/jobs/${jobId}`,
    });
    const job = response.json<RouteJob>();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Route job did not reach a terminal state');
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('route jobs', () => {
  it('creates a background job and exposes status, SSE, and result', async () => {
    const provider = new TestProvider();
    const { app } = createTestApp(provider);

    const created = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: requestBody,
    });

    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      jobId: expect.stringMatching(/^route_/),
      status: 'queued',
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    const job = await waitForTerminal(app, jobId);
    expect(job).toMatchObject({
      status: 'completed',
      progress: 100,
      provider: 'test',
    });

    const result = await app.inject({
      method: 'GET',
      url: `/api/route/jobs/${jobId}/result`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: 'completed',
      cache: { hit: false },
      provider: 'test',
    });

    const events = await app.inject({
      method: 'GET',
      url: `/api/route/jobs/${jobId}/events`,
    });
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.body).toContain('event: snapshot');
    expect(events.body).toContain('event: completed');
  });

  it('keeps job semantics on cache hits', async () => {
    const provider = new TestProvider();
    const cache = new MemoryCache();
    const { app } = createTestApp(provider, 1_000, cache);

    const first = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: requestBody,
    });
    await waitForTerminal(app, first.json<{ jobId: string }>().jobId);

    const second = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: requestBody,
    });
    const secondJob = await waitForTerminal(
      app,
      second.json<{ jobId: string }>().jobId,
    );

    expect(second.statusCode).toBe(202);
    expect(secondJob.cache).toMatchObject({ hit: true });
    expect(provider.calls).toBe(1);
  });

  it('cancels provider work and keeps cancel idempotent', async () => {
    const { app } = createTestApp(new BlockingProvider());
    const created = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: requestBody,
    });
    const jobId = created.json<{ jobId: string }>().jobId;

    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/route/jobs/${jobId}/cancel`,
    });
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/route/jobs/${jobId}/cancel`,
    });

    expect(cancelled.json()).toEqual({ jobId, status: 'cancelled' });
    expect(repeated.json()).toEqual({ jobId, status: 'cancelled' });
    expect((await waitForTerminal(app, jobId)).status).toBe('cancelled');
  });

  it('fails jobs that exceed the provider timeout', async () => {
    const { app } = createTestApp(new BlockingProvider(), 20);
    const created = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: requestBody,
    });
    const job = await waitForTerminal(
      app,
      created.json<{ jobId: string }>().jobId,
    );

    expect(job).toMatchObject({
      status: 'failed',
      error: { code: 'ROUTE_PROVIDER_TIMEOUT' },
    });
  });

  it('rejects invalid requests without creating a job', async () => {
    const { app, store } = createTestApp(new TestProvider());
    const response = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: { travelMode: 'TRANSIT' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(store.jobs.size).toBe(0);
  });

  it('resumes queued or running jobs after a server restart', async () => {
    const { app, store, jobs } = createTestApp(new TestProvider());
    const now = new Date().toISOString();
    await store.save({
      jobId: 'route_resumed',
      status: 'running',
      stage: 'calling_provider',
      progress: 40,
      message: 'Interrupted',
      createdAt: now,
      updatedAt: now,
      request: requestBody,
    });

    expect(await jobs.resumePending()).toBe(1);
    expect(await waitForTerminal(app, 'route_resumed')).toMatchObject({
      status: 'completed',
      progress: 100,
    });
  });
});
