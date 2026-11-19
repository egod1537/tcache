import { randomUUID } from 'node:crypto';

import type { NormalizedAiRequest } from '../types/ai.js';
import { toAiRequestMetadata } from '../types/ai.js';
import type { AiJob } from './ai-job.js';
import type { AiJobEventBus } from './ai-job-events.js';
import { AiJobRunner } from './ai-job-runner.js';
import type { AiJobStore } from './ai-job-store.js';

export class AiJobService {
  public constructor(
    private readonly store: AiJobStore,
    private readonly events: AiJobEventBus,
    private readonly runner: AiJobRunner,
  ) {}

  public async create(
    request: NormalizedAiRequest,
    sessionOwner?: string,
  ): Promise<AiJob> {
    const now = new Date().toISOString();
    const job: AiJob = {
      jobId: `ai_${randomUUID().replaceAll('-', '')}`,
      ...(sessionOwner ? { sessionOwner } : {}),
      status: 'queued',
      stage: 'queued',
      progress: 0,
      provider: request.provider,
      model: request.model,
      message: 'AI job queued',
      createdAt: now,
      updatedAt: now,
      request,
      requestMetadata: toAiRequestMetadata(request),
    };
    await this.store.save(job);
    await this.events.publish(job.jobId, { type: 'progress', job });
    this.schedule(job.jobId);
    return job;
  }

  public get(jobId: string) {
    return this.store.get(jobId);
  }

  public list(limit: number, sessionOwner?: string) {
    return this.store.list(limit, sessionOwner);
  }

  public cancel(jobId: string) {
    return this.runner.cancel(jobId);
  }

  public async resumePending(limit = 100) {
    const jobs = await this.store.list(limit);
    const pending = jobs.filter(
      (job) => job.status === 'queued' || job.status === 'running',
    );
    for (const job of pending) {
      const resumed: AiJob = {
        ...job,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: 'AI job resumed after server restart',
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(resumed);
      this.schedule(job.jobId);
    }
    return pending.length;
  }

  private schedule(jobId: string): void {
    setImmediate(() => {
      void this.runner.run(jobId).catch(() => {
        // Persistence may be unavailable even while recording a failed job.
        // Never log provider payloads or Redis error messages here.
        console.error({
          event: 'ai_job_run_failed',
          jobId,
          code: 'JOB_STATE_UNAVAILABLE',
        });
      });
    });
  }
}
