import { randomUUID } from 'node:crypto';
import type { MatrixJobEventBus } from './matrix-job-events.js';
import type { MatrixJobRunner } from './matrix-job-runner.js';
import type { MatrixJobStore } from './matrix-job-store.js';
import type { MatrixJob } from './matrix-job.js';
import type { MatrixRequest } from './matrix-request.js';

export class MatrixJobService {
  constructor(
    private readonly store: MatrixJobStore,
    private readonly events: MatrixJobEventBus,
    private readonly runner: MatrixJobRunner,
  ) {}

  async create(request: MatrixRequest): Promise<MatrixJob> {
    const now = new Date().toISOString();
    const totalPairs =
      request.locations.length * (request.locations.length - 1);
    const job: MatrixJob = {
      jobId: `route-matrix-${randomUUID().replaceAll('-', '')}`,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: 'Matrix job queued',
      createdAt: now,
      updatedAt: now,
      request,
      stats: {
        totalPairs,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 0,
        providerCalls: 0,
      },
    };
    await this.store.save(job);
    await this.events.publish(job.jobId, { type: 'progress', job });
    setImmediate(() => void this.runner.run(job.jobId));
    return job;
  }

  get(jobId: string) {
    return this.store.get(jobId);
  }

  cancel(jobId: string) {
    return this.runner.cancel(jobId);
  }

  async resumePending(limit = 100) {
    const jobs = await this.store.list(limit);
    const pending = jobs.filter(
      ({ status }) => status === 'queued' || status === 'running',
    );
    for (const job of pending) {
      const resumed: MatrixJob = {
        ...job,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: 'Matrix job resumed after server restart',
        updatedAt: new Date().toISOString(),
        stats: {
          totalPairs:
            job.request.locations.length * (job.request.locations.length - 1),
          completedPairs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          providerCalls: 0,
        },
      };
      await this.store.save(resumed);
      setImmediate(() => void this.runner.run(job.jobId));
    }
    return pending.length;
  }
}
