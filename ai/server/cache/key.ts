import { createHash } from 'node:crypto';

import type { NormalizedAiRequest } from '../types/ai.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
  );
}

export function createAiCacheKey(
  request: NormalizedAiRequest,
  sessionOwner?: string,
): string {
  const generationInput = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== 'cache'),
  );
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        stable(
          sessionOwner ? { sessionOwner, generationInput } : generationInput,
        ),
      ),
    )
    .digest('hex');
  return `ai:v1:${digest}`;
}
