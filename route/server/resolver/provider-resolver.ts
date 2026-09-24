import { validateRouteRequestForProvider } from '../providers/location-validation.js';
import {
  ROUTE_PROVIDER_NAMES,
  type RouteProvider,
  type RouteProviderCapabilities,
  type RouteProviderName,
} from '../providers/provider.js';
import type { NormalizedRouteRequest } from '../types/route.js';

export interface RouteProviderSelection {
  provider: RouteProviderName;
  reason: string;
  capabilities?: RouteProviderCapabilities;
  available?: boolean;
  unavailableReason?: string;
}

export interface RouteProviderResolver {
  resolve(request: NormalizedRouteRequest): RouteProviderSelection;
}

export class RouteProviderResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteProviderResolutionError';
  }
}

export class RouteProviderRegistry {
  private readonly providers = new Map<RouteProviderName, RouteProvider>();

  constructor(providers: RouteProvider[]) {
    for (const provider of providers) {
      const name = toProviderName(provider.providerName);
      if (this.providers.has(name)) {
        throw new Error(`Duplicate route provider: ${name}`);
      }
      this.providers.set(name, provider);
    }
  }

  get(name: RouteProviderName): RouteProvider | undefined {
    return this.providers.get(name);
  }

  require(name: RouteProviderName): RouteProvider {
    const provider = this.get(name);
    if (!provider) {
      throw new RouteProviderResolutionError(
        `Route provider is not configured: ${name}`,
      );
    }
    return provider;
  }

  list() {
    return [...this.providers.entries()].map(([name, provider]) => ({
      name,
      ...(provider.adapterVersion
        ? { adapterVersion: provider.adapterVersion }
        : {}),
      ...(provider.experimental !== undefined
        ? { experimental: provider.experimental }
        : {}),
      ...(provider.cacheMetadata
        ? { cacheMetadata: provider.cacheMetadata }
        : {}),
      ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
      available: provider.available !== false,
      ...(provider.unavailableReason
        ? { unavailableReason: provider.unavailableReason }
        : {}),
    }));
  }

  async diagnostics() {
    return Promise.all(
      [...this.providers.entries()].map(async ([name, provider]) => {
        const base = {
          provider: name,
          configured: provider.available !== false,
        };
        if (!provider.getDiagnostics) return base;
        try {
          return { ...base, ...(await provider.getDiagnostics()) };
        } catch {
          return { ...base, reachable: false };
        }
      }),
    );
  }
}

export interface DefaultRouteProviderResolverOptions {
  registry: RouteProviderRegistry;
  allowOverride?: boolean;
  fixedProvider?: RouteProviderName;
  japanTransitProvider?: Extract<
    RouteProviderName,
    'ekispert' | 'navitime' | 'otp'
  >;
}

export class DefaultRouteProviderResolver implements RouteProviderResolver {
  constructor(private readonly options: DefaultRouteProviderResolverOptions) {}

  resolve(request: NormalizedRouteRequest): RouteProviderSelection {
    const selection = this.select(request);
    const adapter = this.options.registry.require(selection.provider);
    validateRouteProviderCapabilities(
      request,
      selection.provider,
      adapter.capabilities,
    );
    validateRouteRequestForProvider(request, selection.provider);
    return {
      ...selection,
      available: adapter.available !== false,
      ...(adapter.unavailableReason
        ? { unavailableReason: adapter.unavailableReason }
        : {}),
      ...(adapter.capabilities
        ? {
            capabilities: getEffectiveRouteProviderCapabilities(
              adapter.capabilities,
              request.travelMode,
            ),
          }
        : {}),
    };
  }

  private select(request: NormalizedRouteRequest): RouteProviderSelection {
    if (request.provider) {
      if (!this.options.allowOverride) {
        throw new RouteProviderResolutionError(
          'Route provider override is disabled',
        );
      }
      return {
        provider: toProviderName(request.provider),
        reason: `override -> ${request.provider}`,
      };
    }

    if (this.options.fixedProvider) {
      return {
        provider: this.options.fixedProvider,
        reason: `configured -> ${this.options.fixedProvider}`,
      };
    }

    if (request.countryCode === 'JP') {
      const provider =
        request.travelMode === 'TRANSIT'
          ? (this.options.japanTransitProvider ?? 'ekispert')
          : 'google';
      return {
        provider,
        reason: `JP + ${request.travelMode} -> ${provider}`,
      };
    }
    if (request.countryCode === 'KR') {
      const provider =
        request.travelMode === 'DRIVING' ? 'kakao-mobility' : 'kakao-maps';
      return {
        provider,
        reason: `KR + ${request.travelMode} -> ${provider}`,
      };
    }
    return { provider: 'google', reason: 'default -> google' };
  }
}

export function getEffectiveRouteProviderCapabilities(
  capabilities: RouteProviderCapabilities,
  mode: NormalizedRouteRequest['travelMode'],
): RouteProviderCapabilities {
  const modeCapabilities = capabilities.modeCapabilities?.[mode];
  return modeCapabilities
    ? { ...capabilities, ...modeCapabilities }
    : capabilities;
}

export function validateRouteProviderCapabilities(
  request: NormalizedRouteRequest,
  provider: RouteProviderName,
  capabilities: RouteProviderCapabilities | undefined,
) {
  if (!capabilities) return;
  if (!capabilities.modes.includes(request.travelMode)) {
    throw mismatch(provider, `mode ${request.travelMode} is not supported`);
  }
  if (
    request.countryCode &&
    capabilities.countries &&
    !capabilities.countries.includes(request.countryCode)
  ) {
    throw mismatch(provider, `country ${request.countryCode} is not supported`);
  }
  const modeCapabilities = capabilities.modeCapabilities?.[request.travelMode];
  const supportsWaypoints =
    modeCapabilities?.supportsWaypoints ?? capabilities.supportsWaypoints;
  const maxLocations =
    modeCapabilities?.maxLocations ?? capabilities.maxLocations;
  const requiresCoordinates =
    modeCapabilities?.requiresCoordinates ?? capabilities.requiresCoordinates;
  const supportsDepartureTime =
    modeCapabilities?.supportsDepartureTime ??
    capabilities.supportsDepartureTime;
  const requiresDepartureTime =
    modeCapabilities?.requiresDepartureTime ??
    capabilities.requiresDepartureTime;
  const locationCount = request.intermediates.length + 2;
  if (!supportsWaypoints && request.intermediates.length > 0) {
    throw mismatch(provider, 'waypoints are not supported');
  }
  if (maxLocations !== undefined && locationCount > maxLocations) {
    throw mismatch(provider, `at most ${maxLocations} locations are supported`);
  }
  if (
    requiresCoordinates &&
    [request.origin, ...request.intermediates, request.destination].some(
      (location) => !location.coordinates,
    )
  ) {
    throw mismatch(provider, 'coordinates are required for every location');
  }
  if (supportsDepartureTime === false && request.departureTime) {
    throw mismatch(provider, 'departureTime is not supported');
  }
  if (requiresDepartureTime && !request.departureTime) {
    throw mismatch(provider, 'departureTime is required');
  }
}

function mismatch(provider: RouteProviderName, message: string) {
  return new RouteProviderResolutionError(
    `Route provider capability mismatch (${provider}): ${message}`,
  );
}

function toProviderName(value: string | undefined): RouteProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!ROUTE_PROVIDER_NAMES.includes(normalized as RouteProviderName)) {
    throw new RouteProviderResolutionError(
      `Unknown route provider: ${normalized || '(empty)'}`,
    );
  }
  return normalized as RouteProviderName;
}
