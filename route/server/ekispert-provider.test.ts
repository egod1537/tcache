import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRouteCacheKey } from './cache/key.js';
import type { RouteCacheRepository } from './cache/repository.js';
import { createEkispertHttpError } from './providers/ekispert/errors.js';
import {
  directRouteFixture,
  malformedResponseFixture,
  multipleTransferFixture,
  noRouteFixture,
  oneTransferFixture,
  providerErrorFixture,
  walkingAndTrainFixture,
} from './providers/ekispert/fixtures/routes.js';
import {
  formatJapanDepartureTime,
  toEkispertTransitRequest,
} from './providers/ekispert/mapper.js';
import { parseEkispertTransitResponse } from './providers/ekispert/parser.js';
import { EkispertRouteProvider } from './providers/ekispert/provider.js';
import {
  RouteProviderTimeoutError,
  RouteResolver,
} from './resolver/route-resolver.js';
import { normalizeRouteRequest } from './types/route.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function transitRequest() {
  return normalizeRouteRequest({
    origin: {
      coordinates: { latitude: 35.681236, longitude: 139.767125 },
      externalIds: { googlePlaceId: 'google-origin' },
    },
    destination: {
      coordinates: { latitude: 35.658034, longitude: 139.701636 },
      externalIds: { googlePlaceId: 'google-destination' },
    },
    travelMode: 'TRANSIT',
    countryCode: 'JP',
    departureTime: '2026-10-02T01:23:00Z',
    languageCode: 'ja',
  });
}

describe('Ekispert request mapping', () => {
  it('maps WGS84 coordinates, Tokyo time, and no Google IDs', () => {
    const mapped = toEkispertTransitRequest(
      transitRequest(),
      'https://ekispert.example.test',
    );

    expect(mapped.url).toBe(
      'https://ekispert.example.test/v1/json/search/course/extreme',
    );
    expect(mapped.query.get('viaList')).toBe(
      '35.681236,139.767125,wgs84:35.658034,139.701636,wgs84',
    );
    expect(mapped.query.get('date')).toBe('20261002');
    expect(mapped.query.get('time')).toBe('1023');
    expect(mapped.query.get('gcs')).toBe('wgs84');
    expect(mapped.query.toString()).not.toContain('google-origin');
    expect(mapped.query.has('key')).toBe(false);
  });

  it('prefers Ekispert station IDs and supports address/name waypoints', () => {
    const request = normalizeRouteRequest({
      origin: {
        coordinates: { latitude: 35.68, longitude: 139.76 },
        externalIds: {
          ekispertId: '22828',
          googlePlaceId: 'must-not-be-used',
        },
      },
      intermediates: [{ address: '東京都台東区浅草2丁目' }],
      destination: { name: '渋谷' },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T10:00:00+09:00',
    });

    expect(toEkispertTransitRequest(request).query.get('viaList')).toBe(
      '22828:東京都台東区浅草2丁目:渋谷',
    );
  });

  it('converts an instant to Ekispert JST date and time fields', () => {
    expect(formatJapanDepartureTime('2026-01-15T00:30:45Z')).toEqual({
      date: '20260115',
      time: '0930',
    });
    expect(formatJapanDepartureTime('2026-01-15T09:30:45+09:30')).toEqual({
      date: '20260115',
      time: '0900',
    });
  });

  it('rejects Google-only locations and requests over the location limit', () => {
    const googleOnly = normalizeRouteRequest({
      origin: { placeId: 'google-only' },
      destination: { externalIds: { ekispertId: '22715' } },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T10:00:00+09:00',
    });
    expect(() => toEkispertTransitRequest(googleOnly)).toThrow(
      'ekispertId, coordinates, address, or name is required',
    );

    const tooMany = normalizeRouteRequest({
      origin: { externalIds: { ekispertId: '1' } },
      intermediates: Array.from({ length: 19 }, (_, index) => ({
        externalIds: { ekispertId: String(index + 2) },
      })),
      destination: { externalIds: { ekispertId: '21' } },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T10:00:00+09:00',
    });
    expect(() => toEkispertTransitRequest(tooMany)).toThrow(
      'at most 20 locations',
    );
  });
});

describe('Ekispert fixture response normalization', () => {
  it.each([
    ['direct route', directRouteFixture, 1, 0],
    ['one transfer', oneTransferFixture, 2, 1],
    ['multiple transfer', multipleTransferFixture, 3, 2],
    ['walking + train', walkingAndTrainFixture, 2, 0],
  ] as const)('normalizes %s', (_name, fixture, legCount, transfers) => {
    const result = parseEkispertTransitResponse(fixture);
    const route = result.routes[0]!;
    expect(result).toMatchObject({
      provider: 'ekispert',
      metadata: { upstreamStatus: 'OK', apiVersion: '1.27.0.0' },
    });
    expect(route.legs).toHaveLength(legCount);
    expect(route.providerMetadata).toMatchObject({
      transferCount: transfers,
      fare: { amount: 210, currency: 'JPY' },
    });
    expect(route).toMatchObject({
      transferCount: transfers,
      fare: { amount: 210, currency: 'JPY' },
      departureTime: expect.stringContaining('+09:00'),
      arrivalTime: expect.stringContaining('+09:00'),
    });
    expect(route.path.length).toBe(legCount + 1);
  });

  it('keeps walking and train steps in itinerary order', () => {
    const route = parseEkispertTransitResponse(walkingAndTrainFixture)
      .routes[0]!;
    expect(route.legs.map((leg) => leg.steps[0]?.travelMode)).toEqual([
      'WALKING',
      'TRANSIT',
    ]);
    expect(route.legs[1]?.steps[0]?.transitDetails).toMatchObject({
      lineName: 'ＪＲ山手線',
      operatorName: 'Fixture Transit',
      departureStop: { name: '新宿', platform: '3' },
      arrivalStop: { name: '渋谷', platform: '2' },
      numberOfStops: 3,
    });
  });

  it('normalizes direct-route totals, stops, platforms, and line metadata', () => {
    const route = parseEkispertTransitResponse(directRouteFixture).routes[0]!;
    expect(route).toMatchObject({
      description: '東京 → 渋谷',
      distanceMeters: 8700,
      durationSeconds: 1680,
      departureTime: '2026-10-02T10:00:00+09:00',
      arrivalTime: '2026-10-02T10:25:00+09:00',
      legs: [
        {
          steps: [
            {
              travelMode: 'TRANSIT',
              instruction: 'ＪＲ山手線',
              transitDetails: {
                lineName: 'ＪＲ山手線',
                operatorName: 'Fixture Transit',
                departureStop: { id: '22828', name: '東京', platform: '3' },
                arrivalStop: { id: '22715', name: '渋谷', platform: '2' },
                callingAt: [
                  {
                    id: 'fixture-stop',
                    name: '途中駅',
                    arrivalTime: '2026-10-02T10:12:00+09:00',
                    departureTime: '2026-10-02T10:13:00+09:00',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it('normalizes no-route and malformed fixtures', () => {
    expect(() => parseEkispertTransitResponse(noRouteFixture)).toThrow(
      expect.objectContaining({ code: 'ROUTE_PROVIDER_NO_ROUTE' }),
    );
    expect(() =>
      parseEkispertTransitResponse(malformedResponseFixture),
    ).toThrow(expect.objectContaining({ code: 'ROUTE_PROVIDER_BAD_REQUEST' }));
  });
});

describe('Ekispert HTTP, availability, timeout, and cache isolation', () => {
  it.each([
    [403, 'ROUTE_PROVIDER_AUTH_ERROR'],
    [429, 'ROUTE_PROVIDER_RATE_LIMITED'],
    [400, 'ROUTE_PROVIDER_BAD_REQUEST'],
    [504, 'ROUTE_PROVIDER_TIMEOUT'],
    [503, 'ROUTE_PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', (status, code) => {
    expect(createEkispertHttpError(status, providerErrorFixture)).toMatchObject(
      {
        code,
        details: { provider: 'ekispert', httpStatus: status, status: 'W403' },
      },
    );
  });

  it('marks a missing trial key unavailable and fails without fallback', async () => {
    const provider = new EkispertRouteProvider('');
    expect(provider.available).toBe(false);
    expect(provider.unavailableReason).toBe(
      'EKISPERT_API_KEY is not configured',
    );
    await expect(
      provider.getRoute(transitRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('uses query authentication without exposing it in debug output', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(directRouteFixture), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new EkispertRouteProvider(
      'trial-secret',
      'https://ekispert.example.test',
    );
    const response = await provider.getRoute(
      transitRequest(),
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      provider: 'ekispert',
      result: { provider: 'ekispert', routes: [{ distanceMeters: 8700 }] },
      debug: { providerRequest: { query: { searchType: 'departure' } } },
    });
    expect(JSON.stringify(response)).not.toContain('trial-secret');
    const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get('key')).toBe('trial-secret');
    expect(requestedUrl.toString()).not.toContain('%3A35.658034');
  });

  it('passes the shared timeout abort signal to Ekispert fetch', async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: URL, init: RequestInit) => {
        upstreamSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          upstreamSignal?.addEventListener(
            'abort',
            () => reject(upstreamSignal?.reason),
            { once: true },
          );
        });
      }),
    );
    const cache: RouteCacheRepository = {
      async get() {
        return null;
      },
      async set() {},
    };
    const resolver = new RouteResolver({
      cache,
      cachePolicy: { ttlSeconds: 60 },
      provider: new EkispertRouteProvider('trial-key'),
      providerTimeoutMs: 5,
    });

    await expect(
      resolver.resolve(transitRequest(), new AbortController().signal),
    ).rejects.toBeInstanceOf(RouteProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('keeps Ekispert and NAVITIME v4 cache entries separate', () => {
    const request = transitRequest();
    expect(createRouteCacheKey(request, 'ekispert')).toMatch(
      /^route:v4:ekispert:transit:jp:/,
    );
    expect(createRouteCacheKey(request, 'ekispert')).not.toBe(
      createRouteCacheKey(request, 'navitime'),
    );
  });
});
