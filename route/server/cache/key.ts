import { createHash } from 'node:crypto';

import type { NormalizedRouteRequest } from '../types/route.js';
import {
  canonicalizeRouteLocation,
  getTimeBucketPolicy,
  getRouteTemporalMetadata,
  resolveRouteTimeZone,
  type RouteCanonicalizationOptions,
} from './canonical.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

export interface RouteCacheIdentity {
  key: string;
  normalizedRequestHash: string;
}

export function createRouteCacheIdentity(
  request: NormalizedRouteRequest,
  provider = 'unknown',
  options: RouteCanonicalizationOptions = {},
  providerCacheKeySeed?: string,
): RouteCacheIdentity {
  const normalizedProvider = provider.trim().toLowerCase() || 'unknown';
  const countryCode = request.countryCode?.toLowerCase() ?? 'unknown';
  const mode = request.travelMode.toLowerCase();
  const temporal = getRouteTemporalMetadata(request, {
    ...options,
    provider: normalizedProvider,
  });
  const timeZone = resolveRouteTimeZone(request, options.timeZone);
  const bucketPolicy = getTimeBucketPolicy(
    request.travelMode,
    normalizedProvider,
  );
  const canonicalRequest = {
    provider: normalizedProvider,
    ...(providerCacheKeySeed ? { providerCacheKeySeed } : {}),
    mode: request.travelMode,
    countryCode: request.countryCode ?? null,
    timeZone,
    origin: canonicalizeRouteLocation(request.origin, normalizedProvider),
    intermediates: request.intermediates.map((location) =>
      canonicalizeRouteLocation(location, normalizedProvider),
    ),
    destination: canonicalizeRouteLocation(
      request.destination,
      normalizedProvider,
    ),
    computeAlternativeRoutes: request.computeAlternativeRoutes,
    dayType: temporal.dayType,
    timeBucket: temporal.timeBucket,
    timeBucketMinutes: bucketPolicy.minutes,
    ...(request.languageCode ? { languageCode: request.languageCode } : {}),
    ...(request.regionCode ? { regionCode: request.regionCode } : {}),
    ...(request.routingPreference
      ? { routingPreference: request.routingPreference }
      : {}),
    ...(request.units ? { units: request.units } : {}),
    options: request.options,
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(canonicalRequest)))
    .digest('hex');
  return {
    key: `route:v4:${normalizedProvider}:${mode}:${countryCode}:${digest}`,
    normalizedRequestHash: digest,
  };
}

export function createRouteCacheKey(
  request: NormalizedRouteRequest,
  provider = 'unknown',
  options: RouteCanonicalizationOptions = {},
  providerCacheKeySeed?: string,
): string {
  return createRouteCacheIdentity(
    request,
    provider,
    options,
    providerCacheKeySeed,
  ).key;
}
