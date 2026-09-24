import { describe, expect, it } from 'vitest';

import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderName,
} from './providers/provider.js';
import {
  RouteProviderPolicyResolver,
  RouteProviderRegistry,
} from './resolver/provider-resolver.js';
import {
  BUILT_IN_ROUTE_PROVIDER_POLICY,
  type RouteProviderPolicy,
} from './resolver/provider-policy.js';
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
    requiresDepartureTime: true,
  },
  navitime: {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 12,
    requiresDepartureTime: true,
  },
  otp: {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: false,
    maxLocations: 2,
    requiresCoordinates: true,
    requiresDepartureTime: true,
  },
  mock: {
    modes: ['DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT'],
    supportsWaypoints: true,
  },
};

function adapter(
  providerName: RouteProviderName,
  availability: Partial<
    Pick<RouteProvider, 'available' | 'unavailableReason'>
  > = {},
): RouteProvider {
  return {
    providerName,
    capabilities: capabilities[providerName],
    ...availability,
    async getRoute() {
      return { provider: providerName, result: {} };
    },
  };
}

function allProviders() {
  return (Object.keys(capabilities) as RouteProviderName[]).map((name) =>
    adapter(name),
  );
}

function createResolver(
  options: {
    allowOverride?: boolean;
    fixedProvider?: RouteProviderName;
    policy?: RouteProviderPolicy;
    legacyCountryModes?: string[];
    providers?: RouteProvider[];
  } = {},
) {
  return new RouteProviderPolicyResolver({
    registry: new RouteProviderRegistry(options.providers ?? allProviders()),
    policy: options.policy ?? BUILT_IN_ROUTE_PROVIDER_POLICY,
    allowOverride: options.allowOverride ?? true,
    ...(options.fixedProvider ? { fixedProvider: options.fixedProvider } : {}),
    ...(options.legacyCountryModes
      ? { legacyCountryModes: options.legacyCountryModes }
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

describe('RouteProviderPolicyResolver', () => {
  it.each([
    ['JP', 'TRANSIT', 'ekispert'],
    ['JP', 'DRIVING', 'google'],
    ['KR', 'DRIVING', 'kakao-mobility'],
    ['KR', 'TRANSIT', 'kakao-maps'],
  ] as const)('selects %s + %s as %s', (countryCode, mode, provider) => {
    expect(createResolver().resolve(request(countryCode, mode))).toMatchObject({
      provider,
      reason: `${countryCode} + ${mode} -> ${provider}`,
      source: 'country-mode',
    });
  });

  it('uses the mode default for an unknown or omitted country', () => {
    expect(createResolver().resolve(request('US', 'TRANSIT'))).toMatchObject({
      provider: 'google',
      source: 'mode-default',
    });
    expect(
      createResolver().resolve(request(undefined, 'DRIVING')),
    ).toMatchObject({ provider: 'google', source: 'mode-default' });
  });

  it('uses country default, mode default, then global default precedence', () => {
    const policy: RouteProviderPolicy = {
      countries: { JP: { defaultProvider: 'google' } },
      modeDefaults: { TRANSIT: 'google' },
      defaultProvider: 'mock',
    };
    expect(
      createResolver({ policy }).resolve(request('JP', 'DRIVING')),
    ).toMatchObject({ source: 'country-default', provider: 'google' });
    expect(
      createResolver({ policy }).resolve(request('US', 'TRANSIT')),
    ).toMatchObject({ source: 'mode-default', provider: 'google' });
    expect(
      createResolver({ policy }).resolve(request('US', 'DRIVING')),
    ).toMatchObject({ source: 'global-default', provider: 'mock' });
  });

  it('honors an enabled request override', () => {
    expect(
      createResolver().resolve(request('JP', 'TRANSIT', 'google')),
    ).toMatchObject({
      provider: 'google',
      reason: 'request override -> google',
      source: 'request-override',
    });
  });

  it('rejects a request override when disabled', () => {
    expect(() =>
      createResolver({ allowOverride: false }).resolve(
        request('JP', 'TRANSIT', 'google'),
      ),
    ).toThrow('Route provider override is disabled');
  });

  it('makes global force highest priority and forbids request override', () => {
    expect(
      createResolver({ fixedProvider: 'google' }).resolve(
        request('KR', 'DRIVING'),
      ),
    ).toMatchObject({
      provider: 'google',
      reason: 'global force -> google',
      source: 'global-force',
    });
    expect(() =>
      createResolver({ fixedProvider: 'google' }).resolve(
        request('JP', 'TRANSIT', 'otp'),
      ),
    ).toThrow('override is not allowed');
  });

  it('marks a compatibility-injected rule as legacy', () => {
    expect(
      createResolver({ legacyCountryModes: ['JP:TRANSIT'] }).resolve(
        request('JP', 'TRANSIT'),
      ),
    ).toMatchObject({
      provider: 'ekispert',
      reason: 'legacy JP + TRANSIT -> ekispert',
      source: 'legacy',
    });
  });

  it('rejects unsupported provider capabilities without fallback', () => {
    expect(() =>
      createResolver().resolve(request('JP', 'DRIVING', 'navitime')),
    ).toThrow(
      'Route provider capability mismatch (navitime): mode DRIVING is not supported',
    );
  });

  it('rejects coordinate and waypoint capability mismatches', () => {
    expect(() =>
      createResolver().resolve(
        normalizeRouteRequest({
          origin: { address: 'Seoul' },
          destination: { address: 'Busan' },
          travelMode: 'DRIVING',
          countryCode: 'KR',
        }),
      ),
    ).toThrow('coordinates are required for every location');
    expect(() =>
      createResolver().resolve(
        normalizeRouteRequest({
          origin: { latitude: 37.5, longitude: 127 },
          intermediates: [{ latitude: 37.51, longitude: 127.01 }],
          destination: { latitude: 37.52, longitude: 127.02 },
          travelMode: 'TRANSIT',
          countryCode: 'KR',
        }),
      ),
    ).toThrow('waypoints are not supported');
  });

  it('returns effective capabilities for observability', () => {
    expect(createResolver().resolve(request('KR', 'TRANSIT'))).toMatchObject({
      capabilities: {
        supportsWaypoints: false,
        maxLocations: 2,
        requiresCoordinates: true,
      },
    });
  });

  it('rejects missing and unavailable registered providers', () => {
    expect(() =>
      createResolver({ providers: [adapter('google')] }).resolve(
        request('JP', 'TRANSIT'),
      ),
    ).toThrow('Route provider is not configured: ekispert');
    expect(() =>
      createResolver({
        providers: [
          adapter('google'),
          adapter('ekispert', {
            available: false,
            unavailableReason: 'EKISPERT_API_KEY is not configured',
          }),
        ],
      }).resolve(request('JP', 'TRANSIT')),
    ).toThrow('EKISPERT_API_KEY is not configured');
  });

  it('fails when no policy level matches', () => {
    expect(() =>
      createResolver({ policy: { countries: {} } }).resolve(
        request('US', 'TRANSIT'),
      ),
    ).toThrow('No route provider policy matches US + TRANSIT');
  });

  it('lists registered providers for dynamic UI filters', () => {
    const registry = new RouteProviderRegistry([
      adapter('google'),
      adapter('navitime'),
    ]);
    expect(registry.list()).toMatchObject([
      { name: 'google', capabilities: capabilities.google },
      { name: 'navitime', capabilities: capabilities.navitime },
    ]);
  });
});
