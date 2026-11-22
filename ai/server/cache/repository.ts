import type { RedisClient } from '../../../apps/server/src/redis/client.js';

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
  public constructor(private readonly redis: RedisClient) {}

  public async get(key: string): Promise<CachedAiResponse | null> {
    this.requireReady();
    const value = await this.redis.get(`${CACHE_PREFIX}${key}`);
    if (!value) return null;
    try {
      return JSON.parse(value) as CachedAiResponse | null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  public async set(key: string, value: CachedAiResponse, ttlSeconds: number) {
    this.requireReady();
    await this.redis.set(`${CACHE_PREFIX}${key}`, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  }

  private requireReady(): void {
    if (!this.redis.isReady)
      throw new Error('AI response cache is temporarily unavailable');
  }
}
