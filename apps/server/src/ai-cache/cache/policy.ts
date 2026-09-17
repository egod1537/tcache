export interface AiCachePolicy {
  ttlSeconds: number;
}

export function createAiCachePolicy(ttlSeconds: number): AiCachePolicy {
  return { ttlSeconds };
}
