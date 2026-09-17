export interface RouteCachePolicy {
  ttlSeconds: number;
}

export function createRouteCachePolicy(ttlSeconds: number): RouteCachePolicy {
  return { ttlSeconds };
}
