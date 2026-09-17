import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeRouteLocation,
  getRouteDayType,
  getRouteTemporalMetadata,
  getRouteTimeBucket,
} from '../cache/canonical.js';
import { createRouteCacheKey } from '../cache/key.js';
import type { RouteJob } from '../jobs/route-job.js';
import { normalizeRouteRequest } from '../types/route.js';
import { RepositoryRouteAnalyticsRecorder } from './recorder.js';
import type { RouteAnalyticsRepository } from './types.js';

function createRepository(): RouteAnalyticsRepository {
  return { started: vi.fn(), finished: vi.fn() };
}

const completedJob: RouteJob = {
  jobId: 'route_123',
  status: 'completed',
  stage: 'completed',
  progress: 100,
  message: 'done',
  createdAt: '2026-09-19T05:00:00.000Z',
  updatedAt: '2026-09-19T05:00:01.250Z',
  completedAt: '2026-09-19T05:00:01.250Z',
  request: {
    origin: { placeId: 'origin-place' },
    destination: { latitude: 35.6, longitude: 139.7 },
    travelMode: 'TRANSIT',
    departureTime: '2026-09-19T05:27:00.000Z',
  },
  cache: { hit: false, key: 'route:v3:key', ttl: 3_600 },
  provider: 'google',
  providerLatencyMs: 800,
};

describe('route analytics recorder', () => {
  it('shares location, day type, and time bucket canonicalization with cache', () => {
    expect(
      canonicalizeRouteLocation({ type: 'placeId', placeId: ' ChIJ123 ' }),
    ).toBe('place:ChIJ123');
    expect(
      canonicalizeRouteLocation({
        type: 'coordinates',
        latitude: 35.681236,
        longitude: 139.767123,
      }),
    ).toBe('coord:35.68124,139.76712');
    expect(
      canonicalizeRouteLocation({
        type: 'address',
        address: '  東京駅、  日本  ',
      }),
    ).toBe('address:東京駅、 日本');

    const date = new Date('2026-09-19T05:27:00.000Z');
    expect(getRouteDayType(date, 'Asia/Tokyo')).toBe('saturday');
    expect(getRouteDayType(date, 'Asia/Tokyo', true)).toBe('holiday');
    expect(getRouteTimeBucket(date, 'Asia/Tokyo')).toBe('14:20');
  });

  it('records started and completed lifecycle metadata', async () => {
    const repository = createRepository();
    const recorder = new RepositoryRouteAnalyticsRecorder(repository, {
      timeZone: 'Asia/Tokyo',
    });

    await recorder.started(completedJob, {
      provider: 'google',
      cacheKey: 'route:v3:key',
    });
    await recorder.completed(completedJob, { provider: 'google' });

    expect(repository.started).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'route_123',
        fromKey: 'place:origin-place',
        toKey: 'coord:35.60000,139.70000',
        mode: 'TRANSIT',
        dayType: 'saturday',
        timeBucket: '14:20',
        provider: 'google',
        cacheKey: 'route:v3:key',
      }),
    );
    expect(repository.finished).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'route_123',
        cacheHit: false,
        totalLatencyMs: 1_250,
        providerLatencyMs: 800,
        status: 'completed',
        errorCode: null,
      }),
    );
  });

  it('sets provider latency to null for cache hits and stores only failed error codes', async () => {
    const repository = createRepository();
    const recorder = new RepositoryRouteAnalyticsRecorder(repository, {
      timeZone: 'Asia/Tokyo',
    });
    await recorder.completed(
      {
        ...completedJob,
        cache: { ...completedJob.cache!, hit: true },
        providerLatencyMs: 999,
      },
      { provider: 'google' },
    );
    await recorder.failed(
      {
        ...completedJob,
        status: 'failed',
        stage: 'failed',
        error: { code: 'ROUTE_PROVIDER_TIMEOUT', message: 'timed out' },
      },
      { provider: 'google' },
    );

    expect(repository.finished).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cacheHit: true, providerLatencyMs: null }),
    );
    expect(repository.finished).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: 'failed',
        errorCode: 'ROUTE_PROVIDER_TIMEOUT',
      }),
    );
  });

  it('uses identical temporal inputs for analytics and cache keys', () => {
    const request = normalizeRouteRequest(completedJob.request);
    const options = {
      fallbackTime: new Date(completedJob.createdAt),
      timeZone: 'Asia/Tokyo',
    };
    const temporal = getRouteTemporalMetadata(request, options);
    const first = createRouteCacheKey(request, 'google', options);
    const sameBucket = createRouteCacheKey(
      normalizeRouteRequest({
        ...completedJob.request,
        departureTime: '2026-09-19T05:29:59.000Z',
      }),
      'google',
      options,
    );
    const nextBucket = createRouteCacheKey(
      normalizeRouteRequest({
        ...completedJob.request,
        departureTime: '2026-09-19T05:30:00.000Z',
      }),
      'google',
      options,
    );

    expect(temporal).toEqual({ dayType: 'saturday', timeBucket: '14:20' });
    expect(first).toBe(sameBucket);
    expect(first).not.toBe(nextBucket);
  });
});
