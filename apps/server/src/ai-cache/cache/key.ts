import { createHash } from 'node:crypto';

import type { NormalizedAiRequest } from '../types/ai.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

export function createAiCacheKey(request: NormalizedAiRequest): string {
  const generationInput = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== 'cache'),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(generationInput)))
    .digest('hex');
  return `ai:v1:${digest}`;
}
