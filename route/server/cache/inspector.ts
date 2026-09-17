import type { RedisClient } from '../../../apps/server/src/redis/client.js';
import type { CachedRoute } from './repository.js';

const CACHE_PREFIX = 'tcache:route:cache:';

export interface RouteCacheEntrySummary {
  key: string;
  provider: string | null;
  ttlSeconds: number;
  sizeBytes: number;
}

export interface RouteCacheEntry extends RouteCacheEntrySummary {
  value: CachedRoute;
}

export interface RouteCacheInspector {
  list(limit: number): Promise<RouteCacheEntrySummary[]>;
  get(key: string): Promise<RouteCacheEntry | null>;
}

export class RedisRouteCacheInspector implements RouteCacheInspector {
  constructor(private readonly redis: RedisClient) {}

  async list(limit: number): Promise<RouteCacheEntrySummary[]> {
    const redisKeys: string[] = [];

    for await (const redisKey of this.redis.scanIterator({
      MATCH: `${CACHE_PREFIX}*`,
      COUNT: Math.max(limit, 50),
    })) {
      redisKeys.push(redisKey);
      if (redisKeys.length >= limit) break;
    }

    const entries = await Promise.all(
      redisKeys.map((redisKey) => this.readEntry(redisKey)),
    );
    return entries.filter(
      (entry): entry is RouteCacheEntrySummary => entry !== null,
    );
  }

  async get(key: string): Promise<RouteCacheEntry | null> {
    if (!key || key.length > 512 || key.includes('\0')) return null;
    return this.readEntry(`${CACHE_PREFIX}${key}`, true);
  }

  private async readEntry(
    redisKey: string,
    includeValue: true,
  ): Promise<RouteCacheEntry | null>;
  private async readEntry(
    redisKey: string,
    includeValue?: false,
  ): Promise<RouteCacheEntrySummary | null>;
  private async readEntry(
    redisKey: string,
    includeValue = false,
  ): Promise<RouteCacheEntry | RouteCacheEntrySummary | null> {
    const [serialized, ttlSeconds] = await Promise.all([
      this.redis.get(redisKey),
      this.redis.ttl(redisKey),
    ]);
    if (serialized === null) return null;

    let value: CachedRoute;
    try {
      value = JSON.parse(serialized) as CachedRoute;
    } catch {
      value = { provider: 'invalid-json', result: serialized };
    }

    const summary: RouteCacheEntrySummary = {
      key: redisKey.slice(CACHE_PREFIX.length),
      provider:
        typeof value.provider === 'string' && value.provider
          ? value.provider
          : null,
      ttlSeconds,
      sizeBytes: Buffer.byteLength(serialized),
    };
    return includeValue ? { ...summary, value } : summary;
  }
}
