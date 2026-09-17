import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import { createRouteCachePolicy } from './cache/policy.js';
import { createRouteCacheKey } from './cache/key.js';
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
import { GoogleRouteProvider } from './providers/google/client.js';
import { toGoogleRoutesRequest } from './providers/google/mapper.js';
import { parseGoogleRoutesResponse } from './providers/google/parser.js';
import {
  boundsFromPath,
  decodeGooglePolyline,
  encodeGooglePolyline,
} from './providers/google/polyline.js';
import {
  normalizeRouteRequest,
  type NormalizedRouteRequest,
} from './types/route.js';

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
  vi.restoreAllMocks();
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

describe('Google route provider mapping and parsing', () => {
  it('maps address, coordinates, place IDs, intermediates, and options', () => {
    const normalized = normalizeRouteRequest({
      origin: { type: 'address', address: ' 東京駅、日本 ' },
      intermediates: [
        { type: 'coordinates', latitude: 35.7148, longitude: 139.7967 },
        { type: 'placeId', placeId: 'ChIJ-example' },
      ],
      destination: { latitude: 35.6586, longitude: 139.7454 },
      travelMode: 'driving',
      computeAlternativeRoutes: true,
      languageCode: 'ja',
      regionCode: 'JP',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: '2026-09-18T01:00:00.000Z',
      units: 'METRIC',
    });

    expect(toGoogleRoutesRequest(normalized)).toEqual({
      origin: { address: '東京駅、日本' },
      intermediates: [
        {
          location: {
            latLng: { latitude: 35.7148, longitude: 139.7967 },
          },
        },
        { placeId: 'ChIJ-example' },
      ],
      destination: {
        location: {
          latLng: { latitude: 35.6586, longitude: 139.7454 },
        },
      },
      travelMode: 'DRIVE',
      computeAlternativeRoutes: true,
      languageCode: 'ja',
      regionCode: 'JP',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: '2026-09-18T01:00:00.000Z',
      units: 'METRIC',
    });
  });

  it.each([
    ['DRIVING', 'DRIVE'],
    ['WALKING', 'WALK'],
    ['BICYCLING', 'BICYCLE'],
    ['TRANSIT', 'TRANSIT'],
  ] as const)('maps travel mode %s to %s', (travelMode, expected) => {
    const normalized = normalizeRouteRequest({
      origin: { address: 'A' },
      destination: { address: 'B' },
      travelMode,
    });
    expect(toGoogleRoutesRequest(normalized).travelMode).toBe(expected);
  });

  it('decodes encoded polylines and calculates fallback bounds', () => {
    const path = decodeGooglePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(path).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(boundsFromPath(path)).toEqual({
      north: 43.252,
      south: 38.5,
      east: -120.2,
      west: -126.453,
    });
    expect(encodeGooglePolyline(path)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('normalizes routes, legs, paths, and prefers the Google viewport', () => {
    const routes = parseGoogleRoutesResponse({
      routes: [
        {
          description: 'Fast route',
          routeLabels: ['DEFAULT_ROUTE'],
          distanceMeters: 12_345,
          duration: '2345.5s',
          polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          viewport: {
            low: { latitude: 35, longitude: 139 },
            high: { latitude: 36, longitude: 140 },
          },
          legs: [
            {
              distanceMeters: 12_345,
              duration: '2345s',
              startLocation: {
                latLng: { latitude: 35.1, longitude: 139.1 },
              },
              endLocation: {
                latLng: { latitude: 35.9, longitude: 139.9 },
              },
              steps: [
                {
                  distanceMeters: 100,
                  staticDuration: '12s',
                  travelMode: 'DRIVE',
                  navigationInstruction: { instructions: 'Head east' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(routes[0]).toMatchObject({
      description: 'Fast route',
      distanceMeters: 12_345,
      durationSeconds: 2345.5,
      bounds: { north: 36, south: 35, east: 140, west: 139 },
      legs: [
        {
          durationSeconds: 2345,
          startLocation: { lat: 35.1, lng: 139.1 },
          steps: [
            {
              durationSeconds: 12,
              travelMode: 'DRIVE',
              instruction: 'Head east',
            },
          ],
        },
      ],
    });
    expect(routes[0]?.path).toHaveLength(3);
  });

  it('preserves Google HTTP error details without exposing the API key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: 'Invalid origin',
              debug: 'super-secret-key',
            },
          }),
          { status: 400 },
        ),
    );
    const provider = new GoogleRouteProvider('super-secret-key');
    const normalized = normalizeRouteRequest({
      origin: { address: 'A' },
      destination: { address: 'B' },
      travelMode: 'DRIVING',
    });

    await expect(
      provider.getRoute(normalized, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'GOOGLE_ROUTES_ERROR',
      message: 'Invalid origin',
      details: {
        upstream: {
          httpStatus: 400,
          status: 'INVALID_ARGUMENT',
          message: 'Invalid origin',
        },
      },
    });
    await expect(
      provider.getRoute(normalized, new AbortController().signal),
    ).rejects.not.toHaveProperty('details.apiKey');

    const { app } = createTestApp(provider);
    const created = await app.inject({
      method: 'POST',
      url: '/api/route/jobs',
      payload: {
        origin: { address: 'A' },
        destination: { address: 'B' },
        travelMode: 'DRIVING',
      },
    });
    const job = await waitForTerminal(
      app,
      created.json<{ jobId: string }>().jobId,
    );
    expect(job.error).toMatchObject({
      code: 'GOOGLE_ROUTES_ERROR',
      details: {
        upstream: {
          httpStatus: 400,
          status: 'INVALID_ARGUMENT',
        },
      },
    });
    expect(JSON.stringify(job.error)).not.toContain('super-secret-key');
  });

  it('passes the Job AbortSignal through to fetch', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const provider = new GoogleRouteProvider('backend-key');
    const request = normalizeRouteRequest({
      origin: { address: 'A' },
      destination: { address: 'B' },
      travelMode: 'WALKING',
    });
    const pending = provider.getRoute(request, controller.signal);
    controller.abort(new Error('cancelled by test'));

    await expect(pending).rejects.toThrow('cancelled by test');
  });

  it('queries and merges transit segments when intermediates are present', async () => {
    const firstPath = [
      { lat: 35, lng: 139 },
      { lat: 35.5, lng: 139.5 },
    ];
    const secondPath = [
      { lat: 35.5, lng: 139.5 },
      { lat: 36, lng: 140 },
    ];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          origin: { address: string };
          destination: { address: string };
          intermediates?: unknown[];
        };
        expect(body.intermediates).toBeUndefined();
        const firstSegment = body.origin.address === 'A';
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: firstSegment ? 100 : 200,
                duration: firstSegment ? '60s' : '120s',
                polyline: {
                  encodedPolyline: encodeGooglePolyline(
                    firstSegment ? firstPath : secondPath,
                  ),
                },
                legs: [
                  {
                    distanceMeters: firstSegment ? 100 : 200,
                    duration: firstSegment ? '60s' : '120s',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      });
    const provider = new GoogleRouteProvider('backend-key');
    const request = normalizeRouteRequest({
      origin: { address: 'A' },
      intermediates: [{ address: 'B' }],
      destination: { address: 'C' },
      travelMode: 'TRANSIT',
    });

    const providerResult = await provider.getRoute(
      request,
      new AbortController().signal,
    );
    const result = providerResult.result as {
      routes: Array<{
        distanceMeters: number;
        durationSeconds: number;
        path: unknown[];
        legs: unknown[];
        warnings: string[];
      }>;
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.routes[0]).toMatchObject({
      distanceMeters: 300,
      durationSeconds: 180,
    });
    expect(result.routes[0]?.path).toHaveLength(3);
    expect(result.routes[0]?.legs).toHaveLength(2);
    expect(result.routes[0]?.warnings[0]).toContain('separate segments');
  });
});

describe('route cache keys', () => {
  it('changes when provider or intermediate order changes', () => {
    const first = normalizeRouteRequest({
      origin: { address: 'A' },
      intermediates: [{ address: 'B' }, { address: 'C' }],
      destination: { address: 'D' },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: false,
    });
    const reordered = normalizeRouteRequest({
      origin: { address: 'A' },
      intermediates: [{ address: 'C' }, { address: 'B' }],
      destination: { address: 'D' },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: false,
    });
    const alternatives = normalizeRouteRequest({
      origin: { address: 'A' },
      intermediates: [{ address: 'B' }, { address: 'C' }],
      destination: { address: 'D' },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: true,
    });
    const withDepartureTime = normalizeRouteRequest({
      origin: { address: 'A' },
      intermediates: [{ address: 'B' }, { address: 'C' }],
      destination: { address: 'D' },
      travelMode: 'DRIVING',
      departureTime: '2026-09-18T01:00:00.000Z',
    });

    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(reordered, 'google'),
    );
    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(first, 'mock'),
    );
    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(alternatives, 'google'),
    );
    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(withDepartureTime, 'google'),
    );
  });
});
