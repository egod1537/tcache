import type { RedisClient } from '../../../apps/server/src/redis/client.js';
import type { AiJob } from './ai-job.js';

export interface AiJobStore {
  save(job: AiJob): Promise<void>;
  get(jobId: string): Promise<AiJob | null>;
  list(limit: number, sessionOwner?: string): Promise<AiJob[]>;
}

export class AiJobStorageUnavailableError extends Error {
  public constructor() {
    super('AI job storage is temporarily unavailable');
  }
}

const JOB_PREFIX = 'tcache:ai:job:';
const JOB_INDEX = 'tcache:ai:jobs';

export class RedisAiJobStore implements AiJobStore {
  public constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  public async save(job: AiJob): Promise<void> {
    this.requireReady();
    const score = Date.parse(job.createdAt);
    const member = { score, value: job.jobId };
    const transaction = this.redis
      .multi()
      .set(`${JOB_PREFIX}${job.jobId}`, JSON.stringify(job), {
        EX: this.ttlSeconds,
      })
      .zAdd(JOB_INDEX, [member]);
    if (job.sessionOwner) {
      const sessionIndex = `${JOB_INDEX}:session:${job.sessionOwner}`;
      transaction
        .zAdd(sessionIndex, [member])
        .expire(sessionIndex, this.ttlSeconds);
    }
    await transaction.exec();
  }

  public async get(jobId: string): Promise<AiJob | null> {
    this.requireReady();
    const value = await this.redis.get(`${JOB_PREFIX}${jobId}`);
    return value ? (JSON.parse(value) as AiJob) : null;
  }

  public async list(limit: number, sessionOwner?: string): Promise<AiJob[]> {
    this.requireReady();
    const index = sessionOwner
      ? `${JOB_INDEX}:session:${sessionOwner}`
      : JOB_INDEX;
    const ids = await this.redis.zRange(index, 0, Math.max(0, limit - 1), {
      REV: true,
    });
    const jobs: AiJob[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const job = await this.get(id);
      if (job) jobs.push(job);
      else missing.push(id);
    }
    if (missing.length) {
      this.requireReady();
      await this.redis.zRem(index, missing);
    }
    return jobs;
  }

  private requireReady(): void {
    // Redis can otherwise queue commands submitted during reconnect.
    if (!this.redis.isReady) throw new AiJobStorageUnavailableError();
  }
}
