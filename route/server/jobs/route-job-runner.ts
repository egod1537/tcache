import type { RouteCachePolicy } from '../cache/policy.js';
import { createRouteCacheKey } from '../cache/key.js';
import type { RouteCacheRepository } from '../cache/repository.js';
import {
  canonicalizeRouteLocation,
  getRouteTemporalMetadata,
} from '../cache/canonical.js';
import type {
  RouteAnalyticsContext,
  RouteAnalyticsRecorder,
} from '../analytics/recorder.js';
import type { RouteProvider } from '../providers/provider.js';
import { normalizeRouteRequest } from '../types/route.js';
import {
  isTerminalStatus,
  type RouteJob,
  type RouteJobError,
  type RouteJobEventType,
} from './route-job.js';
import type { RouteJobEventBus } from './route-job-events.js';
import type { RouteJobStore } from './route-job-store.js';

class RouteJobStoppedError extends Error {}

type RouteAnalyticsEvent = keyof RouteAnalyticsRecorder;

export interface RouteJobRunnerOptions {
  store: RouteJobStore;
  events: RouteJobEventBus;
  cache: RouteCacheRepository;
  cachePolicy: RouteCachePolicy;
  provider: RouteProvider;
  providerTimeoutMs: number;
  analytics?: RouteAnalyticsRecorder;
  routeTimeZone?: string;
  isHoliday?: (date: Date) => boolean;
  onAnalyticsError?: (
    error: unknown,
    event: RouteAnalyticsEvent,
    job: RouteJob,
  ) => void;
}

export class RouteJobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly options: RouteJobRunnerOptions) {}

  async run(jobId: string): Promise<void> {
    const initial = await this.options.store.get(jobId);
    if (!initial || isTerminalStatus(initial.status)) return;

    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    let errorCode: RouteJobError['code'] = 'INTERNAL_ERROR';
    let timedOut = false;
    let startedAnalytics: Promise<void> | undefined;

    try {
      await this.transition(jobId, {
        status: 'running',
        stage: 'normalizing_request',
        progress: 5,
        message: 'Route 요청 정규화 중',
      });

      errorCode = 'INVALID_REQUEST';
      const normalizedRequest = normalizeRouteRequest(initial.request);
      const canonicalizationOptions = {
        fallbackTime: new Date(initial.createdAt),
        ...(this.options.routeTimeZone
          ? { timeZone: this.options.routeTimeZone }
          : {}),
        ...(this.options.isHoliday
          ? { isHoliday: this.options.isHoliday }
          : {}),
      };
      const temporal = getRouteTemporalMetadata(
        normalizedRequest,
        canonicalizationOptions,
      );
      const cacheKey = createRouteCacheKey(
        normalizedRequest,
        this.options.provider.providerName ?? 'unknown',
        canonicalizationOptions,
      );

      const checkingCache = await this.transition(jobId, {
        stage: 'checking_cache',
        progress: 10,
        message: 'Route cache 조회 중',
        normalizedRequest,
        requestMetadata: {
          fromKey: canonicalizeRouteLocation(normalizedRequest.origin),
          toKey: canonicalizeRouteLocation(normalizedRequest.destination),
          intermediateKeys: normalizedRequest.intermediates.map(
            canonicalizeRouteLocation,
          ),
          dayType: temporal.dayType,
          timeBucket: temporal.timeBucket,
        },
      });
      startedAnalytics = this.recordAnalytics('started', checkingCache, {
        provider: this.providerName,
        cacheKey,
      });

      errorCode = 'CACHE_ERROR';
      const cached = await this.options.cache.get(cacheKey);
      if (cached) {
        await this.transition(jobId, {
          stage: 'cache_hit',
          progress: 100,
          message: 'Route cache hit',
          cache: {
            hit: true,
            key: cacheKey,
            ttl: this.options.cachePolicy.ttlSeconds,
          },
          provider: cached.provider,
          result: cached.result,
        });
        await this.complete(jobId, 'Cached route result ready');
        return;
      }

      await this.transition(jobId, {
        stage: 'cache_miss',
        progress: 20,
        message: 'Route cache miss',
        cache: {
          hit: false,
          key: cacheKey,
          ttl: this.options.cachePolicy.ttlSeconds,
        },
      });

      await this.transition(jobId, {
        stage: 'calling_provider',
        progress: 40,
        message: 'Route provider 호출 중',
      });

      errorCode = 'PROVIDER_ERROR';
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Route provider timed out'));
      }, this.options.providerTimeoutMs);
      const providerStartedAt = performance.now();
      const providerResult = await this.options.provider
        .getRoute(normalizedRequest, controller.signal)
        .finally(() => clearTimeout(timeout));
      const providerLatencyMs = Math.round(
        performance.now() - providerStartedAt,
      );

      await this.transition(jobId, {
        stage: 'processing_provider_response',
        progress: 75,
        message: 'Provider 응답 처리 중',
        provider: providerResult.provider,
        providerLatencyMs,
      });

      await this.transition(jobId, {
        stage: 'writing_cache',
        progress: 90,
        message: 'Route cache 저장 중',
      });

      errorCode = 'CACHE_ERROR';
      await this.options.cache.set(
        cacheKey,
        providerResult,
        this.options.cachePolicy.ttlSeconds,
      );

      await this.complete(jobId, 'Route job completed', {
        result: providerResult.result,
      });
    } catch (error) {
      const current = await this.options.store.get(jobId);
      if (
        error instanceof RouteJobStoppedError ||
        current?.status === 'cancelled'
      ) {
        return;
      }

      const providerError = getStructuredProviderError(error);
      await this.fail(jobId, {
        code: timedOut
          ? 'ROUTE_PROVIDER_TIMEOUT'
          : (providerError?.code ?? errorCode),
        message: timedOut
          ? `Route provider exceeded ${this.options.providerTimeoutMs}ms timeout`
          : error instanceof Error
            ? error.message
            : 'Unknown route job error',
        ...(providerError?.details !== undefined
          ? { details: providerError.details }
          : {}),
      });
    } finally {
      await startedAnalytics;
      this.controllers.delete(jobId);
    }
  }

  async cancel(jobId: string): Promise<RouteJob | null> {
    const cancelled = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isTerminalStatus(current.status)) return current;

      const now = new Date().toISOString();
      const next: RouteJob = {
        ...current,
        status: 'cancelled',
        stage: 'cancelled',
        message: 'Route job cancelled',
        updatedAt: now,
        completedAt: now,
        error: {
          code: 'JOB_CANCELLED',
          message: 'The route job was cancelled',
        },
      };
      await this.options.store.save(next);
      return next;
    });

    if (cancelled?.status === 'cancelled') {
      this.controllers.get(jobId)?.abort(new Error('Route job cancelled'));
      await this.options.events.publish(jobId, {
        type: 'cancelled',
        job: cancelled,
      });
      await this.recordAnalytics('cancelled', cancelled);
    }
    return cancelled;
  }

  private async complete(
    jobId: string,
    message: string,
    patch: Partial<RouteJob> = {},
  ) {
    const completed = await this.transition(
      jobId,
      {
        ...patch,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        message,
        completedAt: new Date().toISOString(),
      },
      'completed',
    );
    await this.recordAnalytics('completed', completed);
  }

  private async fail(jobId: string, error: RouteJobError) {
    try {
      const failed = await this.transition(
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
      await this.recordAnalytics('failed', failed);
    } catch (transitionError) {
      if (!(transitionError instanceof RouteJobStoppedError))
        throw transitionError;
    }
  }

  private async recordAnalytics(
    event: RouteAnalyticsEvent,
    job: RouteJob,
    context: RouteAnalyticsContext = { provider: this.providerName },
  ) {
    if (!this.options.analytics) return;
    try {
      await this.options.analytics[event](job, context);
    } catch (error) {
      this.options.onAnalyticsError?.(error, event, job);
    }
  }

  private get providerName() {
    return this.options.provider.providerName ?? 'unknown';
  }

  private async transition(
    jobId: string,
    patch: Partial<RouteJob>,
    eventType: RouteJobEventType = 'progress',
  ) {
    const job = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isTerminalStatus(current.status)) {
        throw new RouteJobStoppedError();
      }
      const next: RouteJob = {
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

function getStructuredProviderError(error: unknown): {
  code: RouteJobError['code'];
  details?: unknown;
} | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; details?: unknown };
  if (candidate.code !== 'GOOGLE_ROUTES_ERROR') return null;
  return {
    code: candidate.code,
    ...(candidate.details !== undefined ? { details: candidate.details } : {}),
  };
}
