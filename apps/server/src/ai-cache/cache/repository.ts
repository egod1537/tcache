import type { RedisClient } from '../../redis/client.js';

export interface CachedAiResponse {
  provider: string;
  model: string;
  result: unknown;
}

export interface AiCacheRepository {
  get(key: string): Promise<CachedAiResponse | null>;
  set(key: string, value: CachedAiResponse, ttlSeconds: number): Promise<void>;
}

const CACHE_PREFIX = 'tcache:ai:cache:';

export class RedisAiCacheRepository implements AiCacheRepository {
  constructor(private readonly redis: RedisClient) {}

  async get(key: string): Promise<CachedAiResponse | null> {
    const value = await this.redis.get(`${CACHE_PREFIX}${key}`);
    return value ? (JSON.parse(value) as CachedAiResponse) : null;
  }

  async set(key: string, value: CachedAiResponse, ttlSeconds: number) {
    await this.redis.set(`${CACHE_PREFIX}${key}`, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  }
}
