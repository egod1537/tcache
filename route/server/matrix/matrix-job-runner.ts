import {
  RouteProviderTimeoutError,
  type RouteResolver,
} from '../resolver/route-resolver.js';
import {
  buildDirectedPairs,
  createEmptyDurationMatrix,
  extractDurationSeconds,
  type DirectedPair,
} from './matrix-builder.js';
import type { MatrixJobEventBus } from './matrix-job-events.js';
import type { MatrixJobStore } from './matrix-job-store.js';
import {
  isMatrixTerminalStatus,
  type MatrixJob,
  type MatrixJobError,
  type MatrixJobEventType,
} from './matrix-job.js';
import { toPairRouteRequest } from './matrix-request.js';

class MatrixJobStoppedError extends Error {}

export interface MatrixJobRunnerOptions {
  store: MatrixJobStore;
  events: MatrixJobEventBus;
  resolver: RouteResolver;
  concurrency: number;
}

export class MatrixJobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly options: MatrixJobRunnerOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error('Matrix concurrency must be an integer of at least 1');
    }
  }

  async run(jobId: string): Promise<void> {
    const initial = await this.options.store.get(jobId);
    if (!initial || isMatrixTerminalStatus(initial.status)) return;
    const controller = new AbortController();
    this.controllers.set(jobId, controller);

    try {
      await this.transition(jobId, {
        status: 'running',
        stage: 'normalizing_request',
        progress: 5,
        message: 'Normalizing matrix request',
      });
      const pairs = buildDirectedPairs(initial.request.locations.length);
      const matrix = createEmptyDurationMatrix(
        initial.request.locations.length,
      );
      await this.transition(jobId, {
        stage: 'building_pairs',
        progress: 10,
        message: `Built ${pairs.length} directed route pairs`,
        stats: { ...initial.stats, totalPairs: pairs.length },
      });

      let nextPair = 0;
      let firstFailure: { pair: DirectedPair; error: unknown } | undefined;
      const worker = async () => {
        while (!controller.signal.aborted) {
          const pair = pairs[nextPair];
          nextPair += 1;
          if (!pair) return;
          try {
            const from = initial.request.locations[pair.fromIndex]!;
            const to = initial.request.locations[pair.toIndex]!;
            const resolution = await this.options.resolver.resolve(
              toPairRouteRequest(initial.request, from, to),
              controller.signal,
              { fallbackTime: new Date(initial.createdAt) },
            );
            matrix[pair.fromIndex]![pair.toIndex] = extractDurationSeconds(
              resolution.result,
            );
            await this.recordCompletedPair(jobId, resolution.cacheHit);
          } catch (error) {
            const current = await this.options.store.get(jobId);
            if (current?.status !== 'cancelled' && !firstFailure) {
              firstFailure = { pair, error };
              controller.abort(error);
            }
            return;
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(this.options.concurrency, pairs.length) },
          worker,
        ),
      );
      const current = await this.options.store.get(jobId);
      if (current?.status === 'cancelled') return;
      if (firstFailure) {
        const failure = firstFailure as { pair: DirectedPair; error: unknown };
        const from = initial.request.locations[failure.pair.fromIndex]!;
        const to = initial.request.locations[failure.pair.toIndex]!;
        const code: MatrixJobError['code'] =
          failure.error instanceof RouteProviderTimeoutError
            ? 'ROUTE_PROVIDER_TIMEOUT'
            : 'PAIR_ROUTE_FAILED';
        await this.fail(jobId, {
          code,
          message:
            failure.error instanceof Error
              ? failure.error.message
              : 'Failed to resolve route',
          details: {
            fromId: from.id,
            toId: to.id,
            cause:
              failure.error instanceof Error
                ? failure.error.message
                : String(failure.error),
          },
        });
        return;
      }

      const assembling = await this.transition(jobId, {
        stage: 'assembling_matrix',
        progress: 95,
        message: 'Assembling travel-time matrix',
      });
      await this.transition(
        jobId,
        {
          status: 'completed',
          stage: 'completed',
          progress: 100,
          message: 'Matrix job completed',
          completedAt: new Date().toISOString(),
          result: {
            jobId,
            locations: initial.request.locations.map(({ id }) => ({ id })),
            durationSeconds: matrix,
            metadata: {
              mode: initial.request.mode,
              departureTime: initial.request.departureTime,
              totalPairs: assembling.stats.totalPairs,
              cacheHits: assembling.stats.cacheHits,
              cacheMisses: assembling.stats.cacheMisses,
              providerCalls: assembling.stats.providerCalls,
            },
          },
        },
        'completed',
      );
    } catch (error) {
      const current = await this.options.store.get(jobId);
      if (
        error instanceof MatrixJobStoppedError ||
        current?.status === 'cancelled'
      ) {
        return;
      }
      await this.fail(jobId, {
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error ? error.message : 'Unknown matrix job error',
      });
    } finally {
      this.controllers.delete(jobId);
    }
  }

  async cancel(jobId: string): Promise<MatrixJob | null> {
    const cancelled = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isMatrixTerminalStatus(current.status)) return current;
      const now = new Date().toISOString();
      const next: MatrixJob = {
        ...current,
        status: 'cancelled',
        stage: 'cancelled',
        message: 'Matrix job cancelled',
        updatedAt: now,
        completedAt: now,
        error: {
          code: 'JOB_CANCELLED',
          message: 'The matrix job was cancelled',
        },
      };
      await this.options.store.save(next);
      return next;
    });
    if (cancelled?.status === 'cancelled') {
      this.controllers.get(jobId)?.abort(new Error('Matrix job cancelled'));
      await this.options.events.publish(jobId, {
        type: 'cancelled',
        job: cancelled,
      });
    }
    return cancelled;
  }

  private async recordCompletedPair(jobId: string, cacheHit: boolean) {
    await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isMatrixTerminalStatus(current.status)) {
        throw new MatrixJobStoppedError();
      }
      const completedPairs = current.stats.completedPairs + 1;
      const progress =
        10 + Math.floor((completedPairs / current.stats.totalPairs) * 80);
      const next: MatrixJob = {
        ...current,
        stage: 'resolving_routes',
        progress,
        message: `Resolving route ${completedPairs} / ${current.stats.totalPairs}`,
        updatedAt: new Date().toISOString(),
        stats: {
          ...current.stats,
          completedPairs,
          cacheHits: current.stats.cacheHits + (cacheHit ? 1 : 0),
          cacheMisses: current.stats.cacheMisses + (cacheHit ? 0 : 1),
          providerCalls: current.stats.providerCalls + (cacheHit ? 0 : 1),
        },
      };
      await this.options.store.save(next);
      await this.options.events.publish(jobId, { type: 'progress', job: next });
    });
  }

  private async fail(jobId: string, error: MatrixJobError) {
    try {
      await this.transition(
        jobId,
        {
          status: 'failed',
          stage: 'failed',
          message: error.message,
          completedAt: new Date().toISOString(),
          error,
        },
        'failed',
      );
    } catch (transitionError) {
      if (!(transitionError instanceof MatrixJobStoppedError)) {
        throw transitionError;
      }
    }
  }

  private async transition(
    jobId: string,
    patch: Partial<MatrixJob>,
    eventType: MatrixJobEventType = 'progress',
  ) {
    const job = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isMatrixTerminalStatus(current.status)) {
        throw new MatrixJobStoppedError();
      }
      const next: MatrixJob = {
        ...current,
        ...patch,
        jobId: current.jobId,
        request: current.request,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await this.options.store.save(next);
      return next;
    });
    await this.options.events.publish(jobId, { type: eventType, job });
    return job;
  }

  private async withJobLock<T>(
    jobId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(jobId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(jobId, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(jobId) === tail) this.locks.delete(jobId);
    }
  }
}
