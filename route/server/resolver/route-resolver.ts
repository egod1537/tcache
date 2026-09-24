import { createRouteCacheIdentity } from '../cache/key.js';
import type { RouteCachePolicy } from '../cache/policy.js';
import type { RouteCacheRepository } from '../cache/repository.js';
import type { RouteProvider } from '../providers/provider.js';
import { validateRouteRequestForProvider } from '../providers/location-validation.js';
import type { NormalizedRouteRequest } from '../types/route.js';
import type { RouteCanonicalizationOptions } from '../cache/canonical.js';
import type {
  RouteProviderRegistry,
  RouteProviderResolver,
  RouteProviderSelection,
} from './provider-resolver.js';
import {
  getEffectiveRouteProviderCapabilities,
  validateRouteProviderCapabilities,
} from './provider-resolver.js';

export interface RouteResolution {
  result: unknown;
  provider: string;
  cacheKey: string;
  cacheHit: boolean;
  cacheTtlSeconds: number;
  providerLatencyMs?: number;
  providerSelectionReason: string;
  providerRequest?: unknown;
  rawProviderResponse?: unknown;
}

export interface RouteResolutionObserver {
  checkingCache?(cacheKey: string): Promise<void> | void;
  cacheHit?(cacheKey: string): Promise<void> | void;
  cacheMiss?(cacheKey: string): Promise<void> | void;
  callingProvider?(): Promise<void> | void;
  providerResponded?(
    provider: string,
    providerLatencyMs: number,
  ): Promise<void> | void;
  writingCache?(): Promise<void> | void;
}

export class RouteProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Route provider exceeded ${timeoutMs}ms timeout`);
    this.name = 'RouteProviderTimeoutError';
  }
}

export interface RouteResolverOptions {
  cache: RouteCacheRepository;
  cachePolicy: RouteCachePolicy;
  provider?: RouteProvider;
  providers?: RouteProviderRegistry;
  providerResolver?: RouteProviderResolver;
  providerTimeoutMs: number;
  routeTimeZone?: string;
  isHoliday?: (date: Date) => boolean;
}

/** Shared cache/provider pipeline used by both route and matrix jobs. */
export class RouteResolver {
  constructor(private readonly options: RouteResolverOptions) {
    const fixed = Boolean(options.provider);
    const dynamic = Boolean(options.providers && options.providerResolver);
    if (fixed === dynamic) {
      throw new Error(
        'RouteResolver requires either provider or providers + providerResolver',
      );
    }
  }

  get providerName() {
    return this.options.provider?.providerName ?? 'dynamic';
  }

  selectProvider(request: NormalizedRouteRequest): RouteProviderSelection {
    if (this.options.providerResolver) {
      return this.options.providerResolver.resolve(request);
    }
    const provider = this.options.provider?.providerName ?? 'unknown';
    validateRouteProviderCapabilities(
      request,
      provider as RouteProviderSelection['provider'],
      this.options.provider?.capabilities,
    );
    validateRouteRequestForProvider(request, provider);
    return {
      provider: provider as RouteProviderSelection['provider'],
      reason: `configured -> ${provider}`,
      source: 'global-force',
      available: this.options.provider?.available !== false,
      ...(this.options.provider?.unavailableReason
        ? { unavailableReason: this.options.provider.unavailableReason }
        : {}),
      ...(this.options.provider?.capabilities
        ? {
            capabilities: getEffectiveRouteProviderCapabilities(
              this.options.provider.capabilities,
              request.travelMode,
            ),
          }
        : {}),
    };
  }

  validateRequest(request: NormalizedRouteRequest) {
    return this.selectProvider(request);
  }

  async resolve(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
    canonicalization: RouteCanonicalizationOptions = {},
    observer: RouteResolutionObserver = {},
    selected?: RouteProviderSelection,
  ): Promise<RouteResolution> {
    const selection = selected ?? this.selectProvider(request);
    const provider = this.getProvider(selection);
    const providerRequest = provider.getDebugRequest
      ? redactProviderDebug(provider.getDebugRequest(request))
      : undefined;
    const options: RouteCanonicalizationOptions = {
      ...canonicalization,
      ...(this.options.routeTimeZone
        ? { timeZone: this.options.routeTimeZone }
        : {}),
      ...(this.options.isHoliday ? { isHoliday: this.options.isHoliday } : {}),
    };
    const identity = createRouteCacheIdentity(
      request,
      selection.provider,
      options,
      provider.cacheKeySeed,
    );
    const cacheKey = identity.key;
    await observer.checkingCache?.(cacheKey);

    const cached = await this.options.cache.get(cacheKey);
    if (cached) {
      await observer.cacheHit?.(cacheKey);
      return {
        result: cached.result,
        provider: cached.provider,
        cacheKey,
        cacheHit: true,
        cacheTtlSeconds: this.options.cachePolicy.ttlSeconds,
        providerSelectionReason: selection.reason,
        ...(providerRequest !== undefined ? { providerRequest } : {}),
      };
    }

    await observer.cacheMiss?.(cacheKey);
    await observer.callingProvider?.();
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(
        new RouteProviderTimeoutError(this.options.providerTimeoutMs),
      );
    }, this.options.providerTimeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    const providerStartedAt = performance.now();

    try {
      const providerResult = await provider.getRoute(request, combinedSignal);
      const normalizedResult = withoutTransportDebug(providerResult.result);
      const providerLatencyMs = Math.round(
        performance.now() - providerStartedAt,
      );
      await observer.providerResponded?.(
        providerResult.provider,
        providerLatencyMs,
      );
      await observer.writingCache?.();
      await this.options.cache.set(
        cacheKey,
        {
          provider: providerResult.provider,
          result: normalizedResult,
          metadata: createCacheMetadata(
            providerResult.provider,
            provider.adapterVersion,
            identity.normalizedRequestHash,
            this.options.cachePolicy.ttlSeconds,
            provider.cacheMetadata,
          ),
        },
        this.options.cachePolicy.ttlSeconds,
      );
      return {
        result: normalizedResult,
        provider: providerResult.provider,
        cacheKey,
        cacheHit: false,
        cacheTtlSeconds: this.options.cachePolicy.ttlSeconds,
        providerSelectionReason: selection.reason,
        providerLatencyMs,
        ...(providerRequest !== undefined ? { providerRequest } : {}),
        ...(providerResult.debug?.rawProviderResponse !== undefined
          ? {
              rawProviderResponse: redactProviderDebug(
                providerResult.debug.rawProviderResponse,
              ),
            }
          : {}),
      };
    } catch (error) {
      if (timedOut) {
        throw new RouteProviderTimeoutError(this.options.providerTimeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getProvider(selection: RouteProviderSelection) {
    if (this.options.providers) {
      return this.options.providers.require(selection.provider);
    }
    return this.options.provider!;
  }
}

function withoutTransportDebug(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const normalized = { ...(value as Record<string, unknown>) };
  delete normalized.raw;
  delete normalized.debug;
  return normalized;
}

function redactProviderDebug(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b(Bearer|KakaoAK)\s+\S+/gi, '$1 [REDACTED]')
      .replace(
        /([?&](?:api[-_]?key|token|secret|password)=)[^&#\s]*/gi,
        '$1[REDACTED]',
      );
  }
  if (Array.isArray(value)) return value.map(redactProviderDebug);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      /authorization|api[-_]?key|token|secret|password/i.test(key)
        ? '[REDACTED]'
        : redactProviderDebug(child),
    ]),
  );
}

function createCacheMetadata(
  provider: string,
  providerVersion: string | undefined,
  normalizedRequestHash: string,
  ttlSeconds: number,
  providerMetadata: Record<string, string> | undefined,
) {
  const createdAt = new Date();
  return {
    provider,
    ...(providerVersion ? { providerVersion } : {}),
    normalizedRequestHash,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1_000).toISOString(),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}
