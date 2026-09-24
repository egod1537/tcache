import type { RedisClient } from '../../../apps/server/src/redis/client.js';

export interface CachedRoute {
  provider: string;
  result: unknown;
  /** Missing only on legacy entries waiting for Redis TTL expiry. */
  metadata?: RouteCacheMetadata;
}

export interface RouteCacheMetadata {
  provider: string;
  providerVersion?: string;
  normalizedRequestHash: string;
  createdAt: string;
  expiresAt: string;
  providerMetadata?: Record<string, string>;
}

export interface RouteCacheRepository {
  get(key: string): Promise<CachedRoute | null>;
  set(key: string, value: CachedRoute, ttlSeconds: number): Promise<void>;
}

const CACHE_PREFIX = 'tcache:route:cache:';

export class RedisRouteCacheRepository implements RouteCacheRepository {
  constructor(private readonly redis: RedisClient) {}

  async get(key: string): Promise<CachedRoute | null> {
    const value = await this.redis.get(`${CACHE_PREFIX}${key}`);
    return value ? (JSON.parse(value) as CachedRoute) : null;
  }

  async set(
    key: string,
    value: CachedRoute,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(`${CACHE_PREFIX}${key}`, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  }
}
