import { randomUUID } from 'node:crypto';

import type { NormalizedAiRequest } from '../types/ai.js';
import { toAiRequestMetadata } from '../types/ai.js';
import type { AiJob } from './ai-job.js';
import type { AiJobEventBus } from './ai-job-events.js';
import { AiJobRunner } from './ai-job-runner.js';
import type { AiJobStore } from './ai-job-store.js';

export class AiJobService {
  constructor(
    private readonly store: AiJobStore,
    private readonly events: AiJobEventBus,
    private readonly runner: AiJobRunner,
  ) {}

  async create(request: NormalizedAiRequest): Promise<AiJob> {
    const now = new Date().toISOString();
    const job: AiJob = {
      jobId: `ai_${randomUUID().replaceAll('-', '')}`,
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
    setImmediate(() => void this.runner.run(job.jobId));
    return job;
  }

  get(jobId: string) {
    return this.store.get(jobId);
  }

  list(limit: number) {
    return this.store.list(limit);
  }

  cancel(jobId: string) {
    return this.runner.cancel(jobId);
  }

  async resumePending(limit = 100) {
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
      setImmediate(() => void this.runner.run(job.jobId));
    }
    return pending.length;
  }
}
