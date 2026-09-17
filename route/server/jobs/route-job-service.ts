import { randomUUID } from 'node:crypto';

import type { RouteJobRequest } from '../types/route.js';
import type { RouteJob } from './route-job.js';
import type { RouteJobEventBus } from './route-job-events.js';
import { RouteJobRunner } from './route-job-runner.js';
import type { RouteJobStore } from './route-job-store.js';

export class RouteJobService {
  constructor(
    private readonly store: RouteJobStore,
    private readonly events: RouteJobEventBus,
    private readonly runner: RouteJobRunner,
  ) {}

  async create(request: RouteJobRequest): Promise<RouteJob> {
    const now = new Date().toISOString();
    const job: RouteJob = {
      jobId: `route_${randomUUID().replaceAll('-', '')}`,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: 'Route job queued',
      createdAt: now,
      updatedAt: now,
      request,
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
      const resumed: RouteJob = {
        ...job,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: 'Route job resumed after server restart',
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(resumed);
      setImmediate(() => void this.runner.run(job.jobId));
    }

    return pending.length;
  }
}
