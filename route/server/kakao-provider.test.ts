import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteCacheRepository } from './cache/repository.js';
import { createKakaoHttpError } from './providers/kakao/errors.js';
import {
  KAKAO_MAPS_MODE_ENDPOINTS,
  KAKAO_MOBILITY_DIRECTIONS_URL,
  toKakaoMapsRequest,
  toKakaoMobilityRequest,
} from './providers/kakao/mapper.js';
import { KakaoMobilityRouteProvider } from './providers/kakao/mobility.js';
import {
  parseKakaoMapsResponse,
  parseKakaoMobilityResponse,
} from './providers/kakao/parser.js';
import { KakaoMapsRouteProvider } from './providers/kakao/transit.js';
import {
  RouteProviderTimeoutError,
  RouteResolver,
} from './resolver/route-resolver.js';
import { normalizeRouteRequest } from './types/route.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function request(
  travelMode: 'DRIVING' | 'TRANSIT' | 'WALKING' | 'BICYCLING',
  intermediates: Array<{ latitude: number; longitude: number }> = [],
) {
  return normalizeRouteRequest({
    origin: {
      latitude: 37.394776,
      longitude: 127.111197,
      placeId: 'google-origin-must-not-be-sent',
      name: '출발',
    },
    intermediates,
    destination: {
      latitude: 37.419932,
      longitude: 127.12629,
      placeId: 'google-destination-must-not-be-sent',
      name: '도착',
    },
    travelMode,
    countryCode: 'KR',
    computeAlternativeRoutes: true,
  });
}

describe('Kakao request mapping', () => {
  it('maps Mobility coordinates as longitude,latitude without Google Place IDs', () => {
    const mapped = toKakaoMobilityRequest(
      request('DRIVING', [{ latitude: 37.4, longitude: 127.2 }]),
    );

    expect(mapped.url).toBe(KAKAO_MOBILITY_DIRECTIONS_URL);
    expect(mapped.query.get('origin')).toBe('127.111197,37.394776');
    expect(mapped.query.get('destination')).toBe('127.12629,37.419932');
    expect(mapped.query.get('waypoints')).toBe('127.2,37.4');
    expect(mapped.query.toString()).not.toContain('google-origin');
  });

  it.each([
    ['TRANSIT', KAKAO_MAPS_MODE_ENDPOINTS.TRANSIT],
    ['WALKING', KAKAO_MAPS_MODE_ENDPOINTS.WALKING],
    ['BICYCLING', KAKAO_MAPS_MODE_ENDPOINTS.BICYCLING],
  ] as const)('maps %s to the Kakao Maps endpoint', (mode, endpoint) => {
    const mapped = toKakaoMapsRequest(request(mode));

    expect(mapped.url).toBe(endpoint);
    expect(mapped.query.get('start_x')).toBe('127.111197');
    expect(mapped.query.get('start_y')).toBe('37.394776');
    expect(mapped.query.get('end_x')).toBe('127.12629');
    expect(mapped.query.get('end_y')).toBe('37.419932');
  });

  it('maps walking waypoints to separate longitude and latitude lists', () => {
    const mapped = toKakaoMapsRequest(
      request('WALKING', [
        { latitude: 37.4, longitude: 127.2 },
        { latitude: 37.5, longitude: 127.3 },
      ]),
    );

    expect(mapped.query.get('via_x')).toBe('127.2,127.3');
    expect(mapped.query.get('via_y')).toBe('37.4,37.5');
  });

  it('rejects Kakao locations that only contain a Google Place ID', async () => {
    const provider = new KakaoMapsRouteProvider('test-key');
    const invalid = normalizeRouteRequest({
      origin: { placeId: 'google-origin' },
      destination: { placeId: 'google-destination' },
      travelMode: 'TRANSIT',
      countryCode: 'KR',
    });

    await expect(
      provider.getRoute(invalid, new AbortController().signal),
    ).rejects.toThrow('coordinates are required');
  });
});

describe('Kakao response normalization', () => {
  it('normalizes Mobility summary, sections, guides, and road geometry', () => {
    const result = parseKakaoMobilityResponse({
      trans_id: 'mobility-transaction',
      routes: [
        {
          result_code: 0,
          summary: { distance: 2500, duration: 420, priority: 'RECOMMEND' },
          sections: [
            {
              distance: 2500,
              duration: 420,
              roads: [
                {
                  vertexes: [127.1, 37.1, 127.2, 37.2, 127.3, 37.3],
                },
              ],
              guides: [
                {
                  x: 127.1,
                  y: 37.1,
                  distance: 300,
                  duration: 60,
                  guidance: '직진',
                },
                { x: 127.3, y: 37.3, guidance: '도착' },
              ],
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      provider: 'kakao-mobility',
      metadata: { upstreamStatus: 'OK', transactionId: 'mobility-transaction' },
      routes: [
        {
          distanceMeters: 2500,
          durationSeconds: 420,
          path: [
            { lat: 37.1, lng: 127.1 },
            { lat: 37.2, lng: 127.2 },
            { lat: 37.3, lng: 127.3 },
          ],
          bounds: { north: 37.3, south: 37.1, east: 127.3, west: 127.1 },
        },
      ],
    });
    expect(result.routes[0]?.legs[0]?.steps[0]).toMatchObject({
      travelMode: 'DRIVING',
      instruction: '직진',
      startLocation: { lat: 37.1, lng: 127.1 },
    });
    expect(result).not.toHaveProperty('raw');
  });

  it('normalizes transit routes, step geometry, and transit metadata', () => {
    const result = parseKakaoMapsResponse(
      {
        status: 'OK',
        routes: [
          {
            properties: {
              type: 'BUS_AND_SUBWAY',
              totalDistance: 5013,
              totalTime: 2115,
            },
            steps: [
              {
                properties: {
                  guidance: '버스 76',
                  type: 'BUS',
                  distance: 4127,
                  time: 1158,
                  stops: [{ name: '판교역' }],
                  vehicles: [{ name: '76', type: '마을' }],
                },
                path: {
                  points: [
                    [127.11, 37.39],
                    [127.12, 37.4],
                  ],
                },
              },
            ],
          },
        ],
      },
      'TRANSIT',
    );

    expect(result.routes[0]).toMatchObject({
      distanceMeters: 5013,
      durationSeconds: 2115,
      routeLabels: ['BUS_AND_SUBWAY'],
      path: [
        { lat: 37.39, lng: 127.11 },
        { lat: 37.4, lng: 127.12 },
      ],
      legs: [
        {
          steps: [
            {
              travelMode: 'BUS',
              instruction: '버스 76',
              transitDetails: {
                stops: [{ name: '판교역' }],
                vehicles: [{ name: '76', type: '마을' }],
              },
            },
          ],
        },
      ],
    });
  });

  it.each(['WALKING', 'BICYCLING'] as const)(
    'normalizes %s legs and steps',
    (mode) => {
      const result = parseKakaoMapsResponse(
        {
          status: 'OK',
          route: {
            properties: { totalDistance: 4025, totalTime: 3914 },
            legs: [
              {
                properties: { distance: 4025, time: 3914 },
                steps: [
                  {
                    properties: {
                      distance: 93,
                      time: 84,
                      guidance: '93m 이동',
                      x: 127.11,
                      y: 37.39,
                    },
                    path: {
                      points: [
                        [127.11, 37.39],
                        [127.12, 37.4],
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
        mode,
      );

      expect(result.routes[0]).toMatchObject({
        distanceMeters: 4025,
        durationSeconds: 3914,
        legs: [
          {
            distanceMeters: 4025,
            durationSeconds: 3914,
            steps: [{ travelMode: mode, instruction: '93m 이동' }],
          },
        ],
      });
    },
  );
});

describe('Kakao provider HTTP and errors', () => {
  it.each([
    [401, 'ROUTE_PROVIDER_AUTH_ERROR'],
    [429, 'ROUTE_PROVIDER_RATE_LIMITED'],
    [504, 'ROUTE_PROVIDER_TIMEOUT'],
    [400, 'ROUTE_PROVIDER_BAD_REQUEST'],
    [503, 'ROUTE_PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', (status, code) => {
    expect(
      createKakaoHttpError('kakao-maps', status, {
        message: 'upstream detail',
      }),
    ).toMatchObject({
      code,
      details: { provider: 'kakao-maps', httpStatus: status },
    });
  });

  it('maps a Kakao application status to a common provider error', () => {
    expect(() =>
      parseKakaoMapsResponse({ status: 'EQUAL_POINTS' }, 'TRANSIT'),
    ).toThrow(
      expect.objectContaining({
        code: 'ROUTE_PROVIDER_BAD_REQUEST',
        details: expect.objectContaining({ status: 'EQUAL_POINTS' }),
      }),
    );
  });

  it('sends the API key only in the authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          routes: [
            {
              properties: { totalDistance: 10, totalTime: 5 },
              steps: [],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new KakaoMapsRouteProvider('secret-test-key');

    await expect(
      provider.getRoute(request('TRANSIT'), new AbortController().signal),
    ).resolves.toMatchObject({
      provider: 'kakao-maps',
      result: { provider: 'kakao-maps', routes: [{ distanceMeters: 10 }] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('secret-test-key');
    expect(init.headers).toEqual({ Authorization: 'KakaoAK secret-test-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('normalizes a mocked upstream HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'quota exceeded' }), {
          status: 429,
        }),
      ),
    );
    const provider = new KakaoMobilityRouteProvider('test-key');

    await expect(
      provider.getRoute(request('DRIVING'), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'ROUTE_PROVIDER_RATE_LIMITED',
      details: { provider: 'kakao-mobility', httpStatus: 429, status: null },
    });
  });

  it('aborts the upstream request when the shared provider timeout expires', async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
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
    const provider = new KakaoMobilityRouteProvider('test-key');
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
      resolver.resolve(request('DRIVING'), new AbortController().signal),
    ).rejects.toBeInstanceOf(RouteProviderTimeoutError);
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
