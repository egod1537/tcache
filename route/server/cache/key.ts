import { createHash } from 'node:crypto';

import type { NormalizedRouteRequest } from '../types/route.js';

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
): string {
  const canonicalRequest = Object.fromEntries(
    Object.entries(request).filter(
      ([key]) => key !== 'waypoints' && key !== 'options',
    ),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(stable({ provider, request: canonicalRequest })))
    .digest('hex');
  return `route:v2:${digest}`;
}
