import type { RedisClient } from '../../../apps/server/src/redis/client.js';
import type { AiJob } from './ai-job.js';

export interface AiJobStore {
  save(job: AiJob): Promise<void>;
  get(jobId: string): Promise<AiJob | null>;
  list(limit: number): Promise<AiJob[]>;
}

const JOB_PREFIX = 'tcache:ai:job:';
const JOB_INDEX = 'tcache:ai:jobs';

export class RedisAiJobStore implements AiJobStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async save(job: AiJob): Promise<void> {
    await this.redis
      .multi()
      .set(`${JOB_PREFIX}${job.jobId}`, JSON.stringify(job), {
        EX: this.ttlSeconds,
      })
      .zAdd(JOB_INDEX, [{ score: Date.parse(job.createdAt), value: job.jobId }])
      .exec();
  }

  async get(jobId: string): Promise<AiJob | null> {
    const value = await this.redis.get(`${JOB_PREFIX}${jobId}`);
    return value ? (JSON.parse(value) as AiJob) : null;
  }

  async list(limit: number): Promise<AiJob[]> {
    const ids = await this.redis.zRange(JOB_INDEX, 0, Math.max(0, limit - 1), {
      REV: true,
    });
    const jobs: AiJob[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const job = await this.get(id);
      if (job) jobs.push(job);
      else missing.push(id);
    }
    if (missing.length) await this.redis.zRem(JOB_INDEX, missing);
    return jobs;
  }
}
