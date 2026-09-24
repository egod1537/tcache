import { validateRouteRequestForProvider } from '../providers/location-validation.js';
import {
  ROUTE_PROVIDER_NAMES,
  type RouteProvider,
  type RouteProviderCapabilities,
  type RouteProviderName,
} from '../providers/provider.js';
import type { NormalizedRouteRequest } from '../types/route.js';
import {
  BUILT_IN_ROUTE_PROVIDER_POLICY,
  countryModeKey,
  type RouteProviderPolicy,
  type RouteProviderPolicySource,
} from './provider-policy.js';

export type RouteProviderSelectionSource =
  | 'request-override'
  | 'global-force'
  | 'country-mode'
  | 'country-default'
  | 'mode-default'
  | 'global-default'
  | 'legacy';

export interface RouteProviderResolutionContext {
  policySource?: RouteProviderPolicySource;
}

export interface RouteProviderSelection {
  provider: RouteProviderName;
  reason: string;
  source: RouteProviderSelectionSource;
  capabilities?: RouteProviderCapabilities;
  available?: boolean;
  unavailableReason?: string;
}

export interface RouteProviderResolver {
  resolve(
    request: NormalizedRouteRequest,
    context?: RouteProviderResolutionContext,
  ): RouteProviderSelection;
}

export class RouteProviderResolutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ROUTE_PROVIDER_RESOLUTION_ERROR'
      | 'PROVIDER_NOT_CONFIGURED'
      | 'UNSUPPORTED_PROVIDER_CAPABILITY' = 'ROUTE_PROVIDER_RESOLUTION_ERROR',
    readonly details?: unknown,
  ) {
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
        'PROVIDER_NOT_CONFIGURED',
        { provider: name },
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

export interface RouteProviderPolicyResolverOptions {
  registry: RouteProviderRegistry;
  policy?: RouteProviderPolicy;
  policySource?: RouteProviderPolicySource;
  legacyCountryModes?: string[];
  allowOverride?: boolean;
  fixedProvider?: RouteProviderName;
}

export class RouteProviderPolicyResolver implements RouteProviderResolver {
  private readonly policy: RouteProviderPolicy;
  private readonly legacyCountryModes: Set<string>;

  constructor(private readonly options: RouteProviderPolicyResolverOptions) {
    this.policy =
      options.policy ?? structuredClone(BUILT_IN_ROUTE_PROVIDER_POLICY);
    this.legacyCountryModes = new Set(options.legacyCountryModes ?? []);
  }

  resolve(request: NormalizedRouteRequest): RouteProviderSelection {
    const selection = this.select(request);
    const adapter = this.options.registry.require(selection.provider);
    if (adapter.available === false) {
      throw new RouteProviderResolutionError(
        `Route provider is not configured: ${selection.provider}${adapter.unavailableReason ? ` (${adapter.unavailableReason})` : ''}`,
        'PROVIDER_NOT_CONFIGURED',
        {
          provider: selection.provider,
          ...(adapter.unavailableReason
            ? { reason: adapter.unavailableReason }
            : {}),
        },
      );
    }
    validateRouteProviderCapabilities(
      request,
      selection.provider,
      adapter.capabilities,
    );
    validateRouteRequestForProvider(request, selection.provider);
    return {
      ...selection,
      available: true,
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
    if (this.options.fixedProvider) {
      if (request.provider) {
        throw new RouteProviderResolutionError(
          'Route provider override is not allowed when ROUTE_PROVIDER is forced',
        );
      }
      return {
        provider: this.options.fixedProvider,
        reason: `global force -> ${this.options.fixedProvider}`,
        source: 'global-force',
      };
    }

    if (request.provider) {
      if (!this.options.allowOverride) {
        throw new RouteProviderResolutionError(
          'Route provider override is disabled',
        );
      }
      return {
        provider: toProviderName(request.provider),
        reason: `request override -> ${request.provider}`,
        source: 'request-override',
      };
    }

    const countryCode = request.countryCode;
    const countryPolicy = countryCode
      ? this.policy.countries[countryCode]
      : undefined;
    const exactProvider = countryPolicy?.modes?.[request.travelMode];
    if (countryCode && exactProvider) {
      const legacy = this.legacyCountryModes.has(
        countryModeKey(countryCode, request.travelMode),
      );
      return {
        provider: exactProvider,
        reason: `${legacy ? 'legacy ' : ''}${countryCode} + ${request.travelMode} -> ${exactProvider}`,
        source: legacy ? 'legacy' : 'country-mode',
      };
    }
    if (countryCode && countryPolicy?.defaultProvider) {
      return {
        provider: countryPolicy.defaultProvider,
        reason: `${countryCode} default -> ${countryPolicy.defaultProvider}`,
        source: 'country-default',
      };
    }
    const modeDefault = this.policy.modeDefaults?.[request.travelMode];
    if (modeDefault) {
      return {
        provider: modeDefault,
        reason: `${request.travelMode} default -> ${modeDefault}`,
        source: 'mode-default',
      };
    }
    if (this.policy.defaultProvider) {
      return {
        provider: this.policy.defaultProvider,
        reason: `global default -> ${this.policy.defaultProvider}`,
        source: 'global-default',
      };
    }
    throw new RouteProviderResolutionError(
      `No route provider policy matches ${countryCode ?? '(no country)'} + ${request.travelMode}`,
    );
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
    'UNSUPPORTED_PROVIDER_CAPABILITY',
    { provider, reason: message },
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
