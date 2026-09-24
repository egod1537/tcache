import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import type { RouteApiContext } from './api/context.js';
import type { RouteProvider } from './providers/provider.js';
import { RouteProviderRegistry } from './resolver/provider-resolver.js';

const apps: ReturnType<typeof buildApp>[] = [];

function provider(
  name: 'google' | 'navitime' | 'ekispert' | 'otp',
): RouteProvider {
  return {
    providerName: name,
    adapterVersion: `${name}-v1`,
    capabilities: {
      countries: name === 'google' ? undefined : ['JP'],
      modes: name === 'google' ? ['DRIVING', 'TRANSIT'] : ['TRANSIT'],
      supportsWaypoints: name !== 'otp',
      maxLocations:
        name === 'navitime'
          ? 12
          : name === 'ekispert'
            ? 20
            : name === 'otp'
              ? 2
              : 27,
    },
    ...(name === 'ekispert'
      ? {
          available: false,
          unavailableReason: 'EKISPERT_API_KEY is not configured',
        }
      : {}),
    ...(name === 'otp'
      ? {
          experimental: true,
          cacheMetadata: { graphBuildId: 'tokyo-20260924' },
          async getDiagnostics() {
            return { reachable: false, endpoint: 'http://otp:8080' };
          },
        }
      : {}),
    async getRoute() {
      return { provider: name, result: {} };
    },
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Route Provider Catalog API', () => {
  it('returns registered adapters and debug policy for dynamic testbed controls', async () => {
    const context = {
      jobs: {},
      events: {},
      providerCatalog: {
        registry: new RouteProviderRegistry([
          provider('google'),
          provider('navitime'),
          provider('ekispert'),
          provider('otp'),
        ]),
        overrideEnabled: false,
        rawProviderResponseEnabled: false,
      },
    } as RouteApiContext;
    const app = buildApp({ routeCache: context });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/route/providers',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providerOverrideEnabled: false,
      rawProviderResponseEnabled: false,
      fallbackPolicy: 'disabled',
      providers: [
        {
          name: 'google',
          adapterVersion: 'google-v1',
          capabilities: { modes: ['DRIVING', 'TRANSIT'] },
        },
        {
          name: 'navitime',
          adapterVersion: 'navitime-v1',
          capabilities: { countries: ['JP'], modes: ['TRANSIT'] },
        },
        {
          name: 'ekispert',
          available: false,
          unavailableReason: 'EKISPERT_API_KEY is not configured',
        },
        {
          name: 'otp',
          experimental: true,
          cacheMetadata: { graphBuildId: 'tokyo-20260924' },
        },
      ],
    });

    const diagnostics = await app.inject({
      method: 'GET',
      url: '/api/route/providers/diagnostics',
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      coreHealthAffected: false,
      providers: expect.arrayContaining([
        {
          provider: 'otp',
          configured: true,
          reachable: false,
          endpoint: 'http://otp:8080',
        },
      ]),
    });
  });
});
