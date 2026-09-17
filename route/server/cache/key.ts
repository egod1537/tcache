import { createHash } from 'node:crypto';

import type { NormalizedRouteRequest } from '../types/route.js';
import {
  canonicalizeRouteLocation,
  getRouteTemporalMetadata,
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

export function createRouteCacheKey(
  request: NormalizedRouteRequest,
  provider = 'unknown',
  options: RouteCanonicalizationOptions = {},
): string {
  const temporal = getRouteTemporalMetadata(request, options);
  const canonicalRequest = {
    origin: canonicalizeRouteLocation(request.origin),
    intermediates: request.intermediates.map(canonicalizeRouteLocation),
    destination: canonicalizeRouteLocation(request.destination),
    travelMode: request.travelMode,
    computeAlternativeRoutes: request.computeAlternativeRoutes,
    dayType: temporal.dayType,
    timeBucket: temporal.timeBucket,
    ...(request.languageCode ? { languageCode: request.languageCode } : {}),
    ...(request.regionCode ? { regionCode: request.regionCode } : {}),
    ...(request.routingPreference
      ? { routingPreference: request.routingPreference }
      : {}),
    ...(request.units ? { units: request.units } : {}),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(stable({ provider, request: canonicalRequest })))
    .digest('hex');
  return `route:v3:${digest}`;
}
