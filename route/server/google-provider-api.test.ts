import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import type { RouteApiContext } from './api/context.js';
import { GoogleRoutesError } from './providers/google/errors.js';
import type {
  RouteProvider,
  RouteProviderResult,
} from './providers/provider.js';
import type { NormalizedRouteRequest } from './types/route.js';

const apps: ReturnType<typeof buildApp>[] = [];

function createApp(
  provider: RouteProvider,
  timeoutMs = 1_000,
  exposeRawProviderResponse = true,
) {
  const context = {
    jobs: {},
    events: {},
    googleProviderDebug: {
      provider,
      timeoutMs,
      exposeRawProviderResponse,
    },
  } as RouteApiContext;
  const app = buildApp({ routeCache: context });
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Google provider debug API', () => {
  it('normalizes input and calls the provider directly', async () => {
    const getRoute = vi
      .fn<
        (
          request: NormalizedRouteRequest,
          signal: AbortSignal,
        ) => Promise<RouteProviderResult>
      >()
      .mockResolvedValue({
        provider: 'google',
        result: {
          provider: 'google',
          routes: [],
          raw: { routes: [] },
          debug: {
            request: { travelMode: 'DRIVE' },
            fieldMask: 'routes.duration',
            httpStatus: 200,
            latencyMs: 18,
          },
        },
      });
    const response = await createApp({
      providerName: 'google',
      getRoute,
    }).inject({
      method: 'POST',
      url: '/api/route/provider/google/compute',
      payload: {
        origin: { type: 'address', address: '東京駅、日本' },
        intermediates: [
          { type: 'coordinates', latitude: 35.7148, longitude: 139.7967 },
        ],
        destination: { type: 'placeId', placeId: 'destination-place' },
        travelMode: 'driving',
        computeAlternativeRoutes: true,
        languageCode: 'ja',
        regionCode: 'JP',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(getRoute).toHaveBeenCalledTimes(1);
    expect(getRoute.mock.calls[0]?.[0]).toMatchObject({
      origin: { address: '東京駅、日本' },
      intermediates: [
        { coordinates: { latitude: 35.7148, longitude: 139.7967 } },
      ],
      destination: {
        externalIds: { googlePlaceId: 'destination-place' },
      },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: true,
    });
    expect(response.json()).toMatchObject({
      provider: 'google',
      normalizedRequest: { travelMode: 'DRIVING' },
      result: {
        provider: 'google',
        debug: { request: { travelMode: 'DRIVE' }, latencyMs: 18 },
      },
    });
  });

  it('returns normalized Google upstream errors without a stack trace', async () => {
    const provider: RouteProvider = {
      providerName: 'google',
      getRoute: vi.fn().mockRejectedValue(
        new GoogleRoutesError('Invalid waypoint', {
          upstream: {
            httpStatus: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid waypoint',
          },
        }),
      ),
    };
    const response = await createApp(provider).inject({
      method: 'POST',
      url: '/api/route/provider/google/compute',
      payload: {
        origin: { address: 'Tokyo' },
        destination: { address: 'Kyoto' },
        travelMode: 'DRIVING',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: {
        code: 'GOOGLE_ROUTES_ERROR',
        message: 'Invalid waypoint',
        details: {
          upstream: {
            httpStatus: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid waypoint',
          },
        },
      },
    });
    expect(response.body).not.toContain('stack');
  });

  it('removes raw and debug provider payloads when production exposure is disabled', async () => {
    const provider: RouteProvider = {
      providerName: 'google',
      getRoute: vi.fn().mockResolvedValue({
        provider: 'google',
        result: {
          provider: 'google',
          routes: [],
          raw: { apiKey: 'provider-secret' },
          debug: { headers: { Authorization: 'provider-secret' } },
        },
      }),
    };
    const response = await createApp(provider, 1_000, false).inject({
      method: 'POST',
      url: '/api/route/provider/google/compute',
      payload: {
        origin: { address: 'Tokyo' },
        destination: { address: 'Kyoto' },
        travelMode: 'DRIVING',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toEqual({
      provider: 'google',
      routes: [],
    });
    expect(response.body).not.toContain('provider-secret');
  });

  it('aborts a provider call when the debug timeout expires', async () => {
    const provider: RouteProvider = {
      providerName: 'google',
      getRoute: (_request, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    };
    const response = await createApp(provider, 5).inject({
      method: 'POST',
      url: '/api/route/provider/google/compute',
      payload: {
        origin: { address: 'Tokyo' },
        destination: { address: 'Kyoto' },
        travelMode: 'DRIVING',
      },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: { code: 'ROUTE_PROVIDER_TIMEOUT' },
    });
  });

  it('rejects invalid input before calling the provider', async () => {
    const provider: RouteProvider = {
      providerName: 'google',
      getRoute: vi.fn(),
    };
    const response = await createApp(provider).inject({
      method: 'POST',
      url: '/api/route/provider/google/compute',
      payload: { travelMode: 'FLYING' },
    });

    expect(response.statusCode).toBe(400);
    expect(provider.getRoute).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_ROUTE_REQUEST' },
    });
  });
});
