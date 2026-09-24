import type { RedisClient } from '../../../apps/server/src/redis/client.js';
import type { MatrixJob } from './matrix-job.js';

export interface MatrixJobStore {
  save(job: MatrixJob): Promise<void>;
  get(jobId: string): Promise<MatrixJob | null>;
  list(limit: number): Promise<MatrixJob[]>;
}

const JOB_PREFIX = 'tcache:route:matrix:job:';
const JOB_INDEX = 'tcache:route:matrix:jobs';

export class RedisMatrixJobStore implements MatrixJobStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async save(job: MatrixJob): Promise<void> {
    await this.redis
      .multi()
      .set(`${JOB_PREFIX}${job.jobId}`, JSON.stringify(job), {
        EX: this.ttlSeconds,
      })
      .zAdd(JOB_INDEX, [{ score: Date.parse(job.createdAt), value: job.jobId }])
      .exec();
  }

  async get(jobId: string): Promise<MatrixJob | null> {
    const value = await this.redis.get(`${JOB_PREFIX}${jobId}`);
    return value ? (JSON.parse(value) as MatrixJob) : null;
  }

  async list(limit: number): Promise<MatrixJob[]> {
    const ids = await this.redis.zRange(JOB_INDEX, 0, Math.max(limit - 1, 0), {
      REV: true,
    });
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    return jobs.filter((job): job is MatrixJob => job !== null);
  }
}
