import { describe, expect, it } from 'vitest';

import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderName,
} from './providers/provider.js';
import {
  DefaultRouteProviderResolver,
  RouteProviderRegistry,
} from './resolver/provider-resolver.js';
import {
  normalizeRouteRequest,
  type NormalizedRouteRequest,
} from './types/route.js';

const capabilities: Record<RouteProviderName, RouteProviderCapabilities> = {
  google: {
    modes: ['DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 27,
    supportsDepartureTime: true,
  },
  'kakao-mobility': {
    countries: ['KR'],
    modes: ['DRIVING'],
    supportsWaypoints: true,
    maxLocations: 7,
    requiresCoordinates: true,
    supportsDepartureTime: true,
  },
  'kakao-maps': {
    countries: ['KR'],
    modes: ['WALKING', 'BICYCLING', 'TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 7,
    requiresCoordinates: true,
    modeCapabilities: {
      TRANSIT: { supportsWaypoints: false, maxLocations: 2 },
    },
  },
  ekispert: {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 20,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  },
  navitime: {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 12,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  },
  otp: {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: false,
    maxLocations: 2,
    requiresCoordinates: true,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  },
  mock: {
    modes: ['DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT'],
    supportsWaypoints: true,
  },
};

function adapter(providerName: RouteProviderName): RouteProvider {
  return {
    providerName,
    capabilities: capabilities[providerName],
    async getRoute() {
      return { provider: providerName, result: {} };
    },
  };
}

function createResolver(
  options: {
    allowOverride?: boolean;
    japanTransitProvider?: 'ekispert' | 'navitime' | 'otp';
  } = {},
) {
  const registry = new RouteProviderRegistry([
    adapter('google'),
    adapter('kakao-mobility'),
    adapter('kakao-maps'),
    adapter('ekispert'),
    adapter('navitime'),
    adapter('otp'),
    adapter('mock'),
  ]);
  return new DefaultRouteProviderResolver({
    registry,
    allowOverride: options.allowOverride ?? true,
    ...(options.japanTransitProvider
      ? { japanTransitProvider: options.japanTransitProvider }
      : {}),
  });
}

function request(
  countryCode: string | undefined,
  travelMode: NormalizedRouteRequest['travelMode'],
  provider?: string,
) {
  return normalizeRouteRequest({
    origin: { latitude: 35, longitude: 139 },
    destination: { latitude: 36, longitude: 140 },
    travelMode,
    departureTime: '2026-09-24T10:00:00+09:00',
    ...(countryCode ? { countryCode } : {}),
    ...(provider ? { provider } : {}),
  });
}

describe('RouteProviderResolver', () => {
  it.each([
    ['JP', 'TRANSIT', 'ekispert', 'JP + TRANSIT -> ekispert'],
    ['JP', 'DRIVING', 'google', 'JP + DRIVING -> google'],
    ['KR', 'DRIVING', 'kakao-mobility', 'KR + DRIVING -> kakao-mobility'],
    ['KR', 'TRANSIT', 'kakao-maps', 'KR + TRANSIT -> kakao-maps'],
    ['US', 'DRIVING', 'google', 'default -> google'],
  ] as const)(
    'selects %s + %s as %s',
    (countryCode, mode, provider, reason) => {
      expect(
        createResolver().resolve(request(countryCode, mode)),
      ).toMatchObject({
        provider,
        reason,
      });
    },
  );

  it('uses the default Google policy when countryCode is omitted', () => {
    expect(
      createResolver().resolve(request(undefined, 'DRIVING')),
    ).toMatchObject({
      provider: 'google',
      reason: 'default -> google',
    });
  });

  it('honors an enabled explicit provider override', () => {
    expect(
      createResolver().resolve(request('JP', 'TRANSIT', 'google')),
    ).toMatchObject({ provider: 'google', reason: 'override -> google' });
  });

  it('switches the Japan transit default through resolver configuration', () => {
    expect(
      createResolver({ japanTransitProvider: 'navitime' }).resolve(
        request('JP', 'TRANSIT'),
      ),
    ).toMatchObject({
      provider: 'navitime',
      reason: 'JP + TRANSIT -> navitime',
    });
  });

  it('keeps OTP override-only by default and can explicitly promote it', () => {
    expect(createResolver().resolve(request('JP', 'TRANSIT'))).toMatchObject({
      provider: 'ekispert',
    });
    expect(
      createResolver().resolve(request('JP', 'TRANSIT', 'otp')),
    ).toMatchObject({ provider: 'otp', reason: 'override -> otp' });
    expect(
      createResolver({ japanTransitProvider: 'otp' }).resolve(
        request('JP', 'TRANSIT'),
      ),
    ).toMatchObject({ provider: 'otp', reason: 'JP + TRANSIT -> otp' });
  });

  it('rejects an override when production exposure is disabled', () => {
    expect(() =>
      createResolver({ allowOverride: false }).resolve(
        request('JP', 'TRANSIT', 'google'),
      ),
    ).toThrow('Route provider override is disabled');
  });

  it('rejects unsupported modes instead of falling back', () => {
    expect(() =>
      createResolver().resolve(request('JP', 'DRIVING', 'navitime')),
    ).toThrow(
      'Route provider capability mismatch (navitime): mode DRIVING is not supported',
    );
  });

  it('rejects other capability mismatches instead of falling back', () => {
    const value = normalizeRouteRequest({
      origin: { address: 'Seoul' },
      destination: { address: 'Busan' },
      travelMode: 'DRIVING',
      countryCode: 'KR',
    });
    expect(() => createResolver().resolve(value)).toThrow(
      'Route provider capability mismatch (kakao-mobility): coordinates are required for every location',
    );
  });

  it('applies mode-specific Kakao Maps waypoint capabilities', () => {
    const value = normalizeRouteRequest({
      origin: { latitude: 37.5, longitude: 127 },
      intermediates: [{ latitude: 37.51, longitude: 127.01 }],
      destination: { latitude: 37.52, longitude: 127.02 },
      travelMode: 'TRANSIT',
      countryCode: 'KR',
    });
    expect(() => createResolver().resolve(value)).toThrow(
      'Route provider capability mismatch (kakao-maps): waypoints are not supported',
    );
  });

  it('accepts NAVITIME node IDs without coordinates', () => {
    const value = normalizeRouteRequest({
      origin: { externalIds: { navitimeId: '00006668' } },
      destination: { externalIds: { navitimeId: '00003544' } },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-09-24T10:00:00+09:00',
    });
    expect(
      createResolver({ japanTransitProvider: 'navitime' }).resolve(value),
    ).toMatchObject({
      provider: 'navitime',
      reason: 'JP + TRANSIT -> navitime',
    });
  });

  it('returns effective capabilities for observability', () => {
    expect(createResolver().resolve(request('KR', 'TRANSIT'))).toMatchObject({
      capabilities: {
        modes: ['WALKING', 'BICYCLING', 'TRANSIT'],
        supportsWaypoints: false,
        maxLocations: 2,
        requiresCoordinates: true,
      },
    });
  });

  it('lists registered providers for dynamic testbed filters', () => {
    const registry = new RouteProviderRegistry([
      adapter('google'),
      adapter('navitime'),
    ]);
    expect(registry.list()).toMatchObject([
      { name: 'google', capabilities: capabilities.google },
      { name: 'navitime', capabilities: capabilities.navitime },
    ]);
  });

  it('requires departure time for NAVITIME transit', () => {
    const value = normalizeRouteRequest({
      origin: { latitude: 35.68, longitude: 139.76 },
      destination: { latitude: 35.65, longitude: 139.7 },
      travelMode: 'TRANSIT',
      countryCode: 'JP',
    });
    expect(() =>
      createResolver({ japanTransitProvider: 'navitime' }).resolve(value),
    ).toThrow(
      'Route provider capability mismatch (navitime): departureTime is required',
    );
  });

  it('fails clearly when the selected adapter is not configured', () => {
    const registry = new RouteProviderRegistry([adapter('google')]);
    const resolver = new DefaultRouteProviderResolver({ registry });
    expect(() => resolver.resolve(request('JP', 'TRANSIT'))).toThrow(
      'Route provider is not configured: ekispert',
    );
  });
});
