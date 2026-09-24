import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteCacheRepository } from './cache/repository.js';
import {
  createNavitimeHttpError,
  NavitimeRouteProviderError,
} from './providers/navitime/errors.js';
import { NavitimeRouteProvider } from './providers/navitime/client.js';
import {
  formatJapanLocalDateTime,
  toNavitimeTransitRequest,
} from './providers/navitime/mapper.js';
import { parseNavitimeTransitResponse } from './providers/navitime/parser.js';
import {
  DefaultRouteProviderResolver,
  RouteProviderRegistry,
} from './resolver/provider-resolver.js';
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
      latitude: 35.6812996,
      longitude: 139.7670658,
      placeId: 'google-origin-must-not-be-sent',
    },
    intermediates: [],
    destination: {
      latitude: 35.6580339,
      longitude: 139.7016358,
      placeId: 'google-destination-must-not-be-sent',
    },
    travelMode: 'TRANSIT',
    countryCode: 'JP',
    departureTime: '2026-10-02T14:23:00+09:00',
    languageCode: 'ja',
  });
}

const navitimeFixture = {
  items: [
    {
      summary: {
        start: {
          type: 'point',
          coord: { lat: 35.6813, lon: 139.7671 },
          name: '東京',
          node_id: '00006668',
        },
        goal: {
          type: 'point',
          coord: { lat: 35.658, lon: 139.7016 },
          name: '渋谷',
          node_id: '00003544',
        },
        move: {
          transit_count: 1,
          fare: { unit_0: 210, unit_48: 208 },
          reference_fare: { lowest_total_ticket: 210 },
          from_time: '2026-10-02T14:23:00+09:00',
          to_time: '2026-10-02T14:48:00+09:00',
          time: 25,
          distance: 8200,
          move_types: ['walk', 'local_train'],
        },
      },
      sections: [
        {
          type: 'point',
          coord: { lat: 35.6813, lon: 139.7671 },
          name: '東京',
          node_id: '00006668',
        },
        {
          type: 'move',
          move: 'walk',
          from_time: '2026-10-02T14:23:00+09:00',
          to_time: '2026-10-02T14:28:00+09:00',
          time: 5,
          distance: 400,
          line_name: '徒歩',
          next_transit: true,
          transfer_seconds: 120,
        },
        {
          type: 'point',
          coord: { lat: 35.6809, lon: 139.7668 },
          name: '東京駅',
          node_id: '00006668',
          start_platform: '3番線',
        },
        {
          type: 'move',
          move: 'local_train',
          from_time: '2026-10-02T14:30:00+09:00',
          to_time: '2026-10-02T14:48:00+09:00',
          time: 18,
          distance: 7800,
          line_name: 'JR山手線',
          transport: {
            name: 'JR山手線',
            fare: { unit_0: 210, unit_48: 208 },
            company: { id: 'jr-east', name: 'JR東日本' },
            calling_at: [
              {
                node_id: '00001111',
                name: '品川',
                from_time: '2026-10-02T14:39:00+09:00',
                to_time: '2026-10-02T14:40:00+09:00',
              },
            ],
          },
        },
        {
          type: 'point',
          coord: { lat: 35.658, lon: 139.7016 },
          name: '渋谷',
          node_id: '00003544',
          goal_platform: '2番線',
        },
      ],
      shapes: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [139.7671, 35.6813],
                [139.73, 35.67],
                [139.7016, 35.658],
              ],
            },
          },
        ],
      },
    },
  ],
};

describe('NAVITIME request mapping', () => {
  it('maps coordinates as latitude,longitude and never sends Google Place IDs', () => {
    const mapped = toNavitimeTransitRequest(
      transitRequest(),
      'https://navitime.example.test',
    );

    expect(mapped.url).toBe('https://navitime.example.test/route_transit');
    expect(mapped.query.get('start')).toBe('35.6812996,139.7670658');
    expect(mapped.query.get('goal')).toBe('35.6580339,139.7016358');
    expect(mapped.query.get('start_time')).toBe('2026-10-02T14:23:00');
    expect(mapped.query.toString()).not.toContain('google-origin');
  });

  it('prefers NAVITIME node IDs and maps mixed waypoint types', () => {
    const value = normalizeRouteRequest({
      origin: {
        coordinates: { latitude: 35.68, longitude: 139.76 },
        externalIds: {
          navitimeId: '00006668',
          googlePlaceId: 'google-origin',
        },
      },
      intermediates: [
        {
          name: '浅草',
          coordinates: { latitude: 35.7148, longitude: 139.7967 },
        },
        { name: '上野', externalIds: { navitimeId: '00001234' } },
      ],
      destination: { externalIds: { navitimeId: '00003544' } },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T05:23:00Z',
    });

    const mapped = toNavitimeTransitRequest(value);
    expect(mapped.query.get('start')).toBe('00006668');
    expect(mapped.query.get('goal')).toBe('00003544');
    expect(JSON.parse(mapped.query.get('via')!)).toEqual([
      { lat: 35.7148, lon: 139.7967, name: '浅草' },
      { node: '00001234', name: '上野' },
    ]);
  });

  it('converts the same instant to an Asia/Tokyo local start_time', () => {
    expect(formatJapanLocalDateTime('2026-01-15T00:30:45Z')).toBe(
      '2026-01-15T09:30:45',
    );
    expect(formatJapanLocalDateTime('2026-01-15T09:30:45+09:00')).toBe(
      '2026-01-15T09:30:45',
    );
    expect(formatJapanLocalDateTime('2026-01-15T09:30:45+09:30')).toBe(
      '2026-01-15T09:00:45',
    );
  });

  it('rejects a Google-only location', () => {
    const value = normalizeRouteRequest({
      origin: { placeId: 'google-only' },
      destination: { externalIds: { navitimeId: '00003544' } },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T14:23:00+09:00',
    });

    expect(() => toNavitimeTransitRequest(value)).toThrow(
      'navitimeId or coordinates are required',
    );
  });

  it('enforces the official ten-waypoint limit through capabilities', () => {
    const provider = new NavitimeRouteProvider('test-key');
    const resolver = new DefaultRouteProviderResolver({
      registry: new RouteProviderRegistry([provider]),
      japanTransitProvider: 'navitime',
    });
    const value = normalizeRouteRequest({
      origin: { latitude: 35.6, longitude: 139.6 },
      intermediates: Array.from({ length: 11 }, (_, index) => ({
        latitude: 35.61 + index * 0.001,
        longitude: 139.61 + index * 0.001,
      })),
      destination: { latitude: 35.7, longitude: 139.7 },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T14:23:00+09:00',
    });

    expect(() => resolver.resolve(value)).toThrow(
      'at most 12 locations are supported',
    );
  });
});

describe('NAVITIME response normalization', () => {
  it('normalizes route totals, geometry, transit and walking segments', () => {
    const result = parseNavitimeTransitResponse(navitimeFixture);
    const route = result.routes[0]!;

    expect(result.provider).toBe('navitime');
    expect(route).toMatchObject({
      description: '東京 → 渋谷',
      routeLabels: ['1 transfer'],
      distanceMeters: 8200,
      durationSeconds: 1500,
      path: [
        { lat: 35.6813, lng: 139.7671 },
        { lat: 35.67, lng: 139.73 },
        { lat: 35.658, lng: 139.7016 },
      ],
      providerMetadata: {
        transfers: 1,
        departureTime: '2026-10-02T14:23:00+09:00',
        arrivalTime: '2026-10-02T14:48:00+09:00',
        fare: { unit_0: 210, unit_48: 208 },
      },
    });
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0]).toMatchObject({
      distanceMeters: 400,
      durationSeconds: 300,
      steps: [
        {
          travelMode: 'WALKING',
          instruction: '徒歩',
          transitDetails: {
            transferRequired: true,
            departureTime: '2026-10-02T14:23:00+09:00',
          },
        },
      ],
    });
    expect(route.legs[1]?.steps[0]).toMatchObject({
      travelMode: 'TRANSIT',
      instruction: 'JR山手線',
      transitDetails: {
        lineName: 'JR山手線',
        startStation: { id: '00006668', name: '東京駅' },
        endStation: { id: '00003544', name: '渋谷' },
        fare: { unit_0: 210, unit_48: 208 },
        callingAt: [
          {
            id: '00001111',
            name: '品川',
            arrivalTime: '2026-10-02T14:39:00+09:00',
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('raw');
  });

  it('normalizes an empty successful response as no-route', () => {
    expect(() => parseNavitimeTransitResponse({ items: [] })).toThrow(
      expect.objectContaining({ code: 'ROUTE_PROVIDER_NO_ROUTE' }),
    );
  });
});

describe('NAVITIME provider HTTP and errors', () => {
  it.each([
    [401, 'unauthorized', 'ROUTE_PROVIDER_AUTH_ERROR'],
    [429, 'Too Many Requests', 'ROUTE_PROVIDER_RATE_LIMITED'],
    [400, 'parameter error', 'ROUTE_PROVIDER_BAD_REQUEST'],
    [500, 'The specified route is not found.', 'ROUTE_PROVIDER_NO_ROUTE'],
    [504, 'Endpoint request timed out', 'ROUTE_PROVIDER_TIMEOUT'],
    [503, 'server error', 'ROUTE_PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', (status, message, code) => {
    expect(createNavitimeHttpError(status, { message })).toMatchObject({
      code,
      details: { provider: 'navitime', httpStatus: status },
    });
  });

  it('uses RapidAPI authentication and returns only normalized output', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(navitimeFixture), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new NavitimeRouteProvider(
      'secret-key',
      'https://navitime.example.test',
    );

    await expect(
      provider.getRoute(transitRequest(), new AbortController().signal),
    ).resolves.toMatchObject({
      provider: 'navitime',
      result: { provider: 'navitime', routes: [{ distanceMeters: 8200 }] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).not.toContain('secret-key');
    expect(init.headers).toEqual({
      'X-RapidAPI-Key': 'secret-key',
      'X-RapidAPI-Host': 'navitime.example.test',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails clearly when the API key is absent', async () => {
    const provider = new NavitimeRouteProvider('');
    await expect(
      provider.getRoute(transitRequest(), new AbortController().signal),
    ).rejects.toBeInstanceOf(NavitimeRouteProviderError);
    await expect(
      provider.getRoute(transitRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ROUTE_PROVIDER_AUTH_ERROR' });
  });

  it('aborts the upstream request when the shared timeout expires', async () => {
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
    const provider = new NavitimeRouteProvider('test-key');
    const cache: RouteCacheRepository = {
      async get() {
        return null;
      },
      async set() {},
    };
    const resolver = new RouteResolver({
      cache,
      cachePolicy: { ttlSeconds: 60 },
      provider,
      providerTimeoutMs: 5,
    });

    await expect(
      resolver.resolve(transitRequest(), new AbortController().signal),
    ).rejects.toBeInstanceOf(RouteProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
