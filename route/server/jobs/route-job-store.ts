import type { RedisClient } from '../../../apps/server/src/redis/client.js';
import type { RouteJob } from './route-job.js';

export interface RouteJobStore {
  save(job: RouteJob): Promise<void>;
  get(jobId: string): Promise<RouteJob | null>;
  list(limit: number): Promise<RouteJob[]>;
}

const JOB_PREFIX = 'tcache:route:job:';
const JOB_INDEX = 'tcache:route:jobs';

export class RedisRouteJobStore implements RouteJobStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async save(job: RouteJob): Promise<void> {
    await this.redis
      .multi()
      .set(`${JOB_PREFIX}${job.jobId}`, JSON.stringify(job), {
        EX: this.ttlSeconds,
      })
      .zAdd(JOB_INDEX, [{ score: Date.parse(job.createdAt), value: job.jobId }])
      .exec();
  }

  async get(jobId: string): Promise<RouteJob | null> {
    const value = await this.redis.get(`${JOB_PREFIX}${jobId}`);
    return value ? (JSON.parse(value) as RouteJob) : null;
  }

  async list(limit: number): Promise<RouteJob[]> {
    const ids = await this.redis.zRange(JOB_INDEX, 0, Math.max(0, limit - 1), {
      REV: true,
    });
    const jobs: RouteJob[] = [];
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
