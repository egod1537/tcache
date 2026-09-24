import { describe, expect, it, vi } from 'vitest';

import { createRouteCacheKey } from './cache/key.js';
import {
  OTP_ROUTE_ERROR_CODES,
  OtpRouteProviderError,
} from './providers/otp/errors.js';
import {
  otpDirectRouteFixture,
  otpGraphqlErrorFixture,
  otpMultipleItinerariesFixture,
  otpNoRouteFixture,
  otpRoutingErrorFixture,
} from './providers/otp/fixtures/routes.js';
import { OTP_PLAN_QUERY } from './providers/otp/query.js';
import { toOtpTransitRequest } from './providers/otp/mapper.js';
import { parseOtpTransitResponse } from './providers/otp/parser.js';
import { OtpRouteProvider } from './providers/otp/provider.js';
import {
  RouteProviderPolicyResolver,
  RouteProviderRegistry,
} from './resolver/provider-resolver.js';
import { normalizeRouteRequest } from './types/route.js';

function request(overrides: Record<string, unknown> = {}) {
  return normalizeRouteRequest({
    locations: [
      {
        name: 'Tokyo Station',
        coordinates: { latitude: 35.681236, longitude: 139.767125 },
      },
      {
        name: 'Shibuya',
        coordinates: { latitude: 35.658034, longitude: 139.701636 },
      },
    ],
    mode: 'TRANSIT',
    countryCode: 'JP',
    departureTime: '2026-09-25T10:00:00+09:00',
    languageCode: 'ja-JP',
    ...overrides,
  });
}

describe('OpenTripPlanner request mapping and capability', () => {
  it('builds a parameterized GraphQL request from coordinates', () => {
    const mapped = toOtpTransitRequest(
      request({ computeAlternativeRoutes: true }),
      'http://otp:8080/',
    );
    expect(mapped.url).toBe('http://otp:8080/otp/gtfs/v1');
    expect(mapped.language).toBe('ja');
    expect(mapped.body.query).toBe(OTP_PLAN_QUERY);
    expect(mapped.body.query).not.toContain('35.681236');
    expect(mapped.body.variables).toEqual({
      origin: {
        label: 'Tokyo Station',
        location: {
          coordinate: { latitude: 35.681236, longitude: 139.767125 },
        },
      },
      destination: {
        label: 'Shibuya',
        location: {
          coordinate: { latitude: 35.658034, longitude: 139.701636 },
        },
      },
      dateTime: { earliestDeparture: '2026-09-25T10:00:00+09:00' },
      first: 3,
    });
  });

  it('requires coordinates and rejects waypoints through capabilities', () => {
    const provider = new OtpRouteProvider({ enabled: true });
    const resolver = new RouteProviderPolicyResolver({
      registry: new RouteProviderRegistry([provider]),
      allowOverride: true,
    });
    expect(() =>
      resolver.resolve(
        normalizeRouteRequest({
          locations: [{ address: 'Tokyo' }, { address: 'Shibuya' }],
          mode: 'TRANSIT',
          countryCode: 'JP',
          provider: 'otp',
          departureTime: '2026-09-25T10:00:00+09:00',
        }),
      ),
    ).toThrow('coordinates are required for every location');
    expect(() =>
      resolver.resolve(
        request({
          provider: 'otp',
          locations: [
            { latitude: 35.68, longitude: 139.76 },
            { latitude: 35.7, longitude: 139.75 },
            { latitude: 35.65, longitude: 139.7 },
          ],
        }),
      ),
    ).toThrow('waypoints are not supported');
  });
});

describe('OpenTripPlanner response normalization', () => {
  it('normalizes walking and transit legs, geometry, stops, and dataset identity', () => {
    const result = parseOtpTransitResponse(otpDirectRouteFixture, {
      graphBuildId: 'tokyo-20260924',
    });
    expect(result).toMatchObject({
      provider: 'otp',
      metadata: {
        itineraryCount: 1,
        selectionPolicy: 'all-returned-in-upstream-order',
        datasetIdentity: { graphBuildId: 'tokyo-20260924' },
      },
    });
    expect(result.routes[0]).toMatchObject({
      durationSeconds: 900,
      distanceMeters: 8520,
      departureTime: '2026-09-25T10:00:00+09:00',
      arrivalTime: '2026-09-25T10:15:00+09:00',
      transferCount: 0,
      providerMetadata: {
        walkingDurationSeconds: 300,
        transitDurationSeconds: 600,
      },
    });
    expect(result.routes[0]!.path).toHaveLength(3);
    expect(result.routes[0]!.legs[0]!.steps[0]!.travelMode).toBe('WALKING');
    expect(result.routes[0]!.legs[1]!.steps[0]).toMatchObject({
      travelMode: 'TRANSIT',
      transitDetails: {
        lineName: 'Z',
        operatorName: 'Tokyo Metropolitan Bureau',
        departureStop: { id: 'TOEI:OT', platform: '1' },
        arrivalStop: { id: 'TOEI:SB', platform: '2' },
      },
    });
  });

  it('preserves multiple itineraries in upstream order', () => {
    const result = parseOtpTransitResponse(otpMultipleItinerariesFixture);
    expect(result.routes).toHaveLength(2);
    expect(result.routes.map((route) => route.durationSeconds)).toEqual([
      900, 1020,
    ]);
  });

  it.each([
    [otpNoRouteFixture, 'ROUTE_PROVIDER_NO_ROUTE'],
    [otpRoutingErrorFixture, 'ROUTE_PROVIDER_NO_ROUTE'],
    [otpGraphqlErrorFixture, 'ROUTE_PROVIDER_BAD_REQUEST'],
    [{ data: {} }, 'ROUTE_PROVIDER_INVALID_DATA'],
  ])('normalizes an OTP failure as %s', (fixture, code) => {
    expect(() => parseOtpTransitResponse(fixture)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});

describe('OpenTripPlanner HTTP adapter', () => {
  it('posts GraphQL JSON and returns normalized routes', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(otpDirectRouteFixture), { status: 200 }),
    );
    const provider = new OtpRouteProvider({
      baseUrl: 'http://otp:8080/',
      enabled: true,
      fetch: fetchMock,
      graphBuildId: 'graph-a',
      gtfsDatasetVersion: 'toei-2026-09',
      osmDatasetVersion: 'tokyo-2026-09',
    });
    const response = await provider.getRoute(
      request(),
      new AbortController().signal,
    );
    expect(response.result).toMatchObject({
      provider: 'otp',
      routes: [{ durationSeconds: 900 }],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://otp:8080/otp/gtfs/v1');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Accept-Language': 'ja', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operationName: 'PlanTokyo',
      variables: {
        dateTime: { earliestDeparture: expect.stringContaining('+09:00') },
      },
    });
  });

  it('is disabled by default without affecting construction', async () => {
    const provider = new OtpRouteProvider();
    expect(provider.available).toBe(false);
    await expect(
      provider.getRoute(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('aborts its HTTP request at OTP_REQUEST_TIMEOUT_MS', async () => {
    const fetchMock = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const provider = new OtpRouteProvider({
      enabled: true,
      timeoutMs: 5,
      fetch: fetchMock,
    });
    await expect(
      provider.getRoute(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ROUTE_PROVIDER_TIMEOUT' });
  });

  it('uses graph identity as an OTP-only cache seed', () => {
    const first = new OtpRouteProvider({ enabled: true, graphBuildId: 'a' });
    const second = new OtpRouteProvider({ enabled: true, graphBuildId: 'b' });
    expect(
      createRouteCacheKey(request(), 'otp', {}, first.cacheKeySeed),
    ).toMatch(/^route:v4:otp:transit:jp:/);
    expect(
      createRouteCacheKey(request(), 'otp', {}, first.cacheKeySeed),
    ).not.toBe(createRouteCacheKey(request(), 'otp', {}, second.cacheKeySeed));
    expect(createRouteCacheKey(request(), 'ekispert')).not.toBe(
      createRouteCacheKey(request(), 'otp', {}, first.cacheKeySeed),
    );
  });

  it('declares every structured error code accepted by Route Jobs', () => {
    expect(OTP_ROUTE_ERROR_CODES).toContain('ROUTE_PROVIDER_INVALID_DATA');
    expect(
      new OtpRouteProviderError('ROUTE_PROVIDER_UNAVAILABLE', 'offline', {
        provider: 'otp',
        httpStatus: null,
        status: 'UNAVAILABLE',
      }),
    ).toMatchObject({ code: 'ROUTE_PROVIDER_UNAVAILABLE' });
  });
});

const liveEnabled =
  process.env.RUN_LIVE_ROUTE_PROVIDER_TESTS === 'true' &&
  Boolean(process.env.OTP_BASE_URL);

describe.runIf(liveEnabled)('OpenTripPlanner local live integration', () => {
  it('queries the independently built Tokyo graph', async () => {
    const provider = new OtpRouteProvider({
      baseUrl: process.env.OTP_BASE_URL!,
      enabled: true,
      timeoutMs: Number(process.env.OTP_REQUEST_TIMEOUT_MS ?? 30_000),
    });
    await expect(
      provider.getRoute(request(), new AbortController().signal),
    ).resolves.toMatchObject({ provider: 'otp', result: { routes: [{}] } });
  });
});
