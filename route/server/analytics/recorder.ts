import {
  canonicalizeRouteLocation,
  getRouteTemporalMetadata,
} from '../cache/canonical.js';
import { createRouteCacheKey } from '../cache/key.js';
import type { RouteJob } from '../jobs/route-job.js';
import { normalizeRouteRequest } from '../types/route.js';
import type {
  RouteAnalyticsFinishedRecord,
  RouteAnalyticsRepository,
  RouteAnalyticsStartedRecord,
} from './types.js';

export interface RouteAnalyticsContext {
  provider: string;
  cacheKey?: string;
}

export interface RouteAnalyticsRecorder {
  started(job: RouteJob, context: RouteAnalyticsContext): Promise<void>;
  completed(job: RouteJob, context: RouteAnalyticsContext): Promise<void>;
  failed(job: RouteJob, context: RouteAnalyticsContext): Promise<void>;
  cancelled(job: RouteJob, context: RouteAnalyticsContext): Promise<void>;
}

export interface RepositoryRouteAnalyticsRecorderOptions {
  timeZone?: string;
  isHoliday?: (date: Date) => boolean;
}

export class RepositoryRouteAnalyticsRecorder implements RouteAnalyticsRecorder {
  private readonly timeZone: string;
  private readonly isHoliday: (date: Date) => boolean;

  constructor(
    private readonly repository: RouteAnalyticsRepository,
    options: RepositoryRouteAnalyticsRecorderOptions = {},
  ) {
    this.timeZone = options.timeZone ?? 'UTC';
    this.isHoliday = options.isHoliday ?? (() => false);
  }

  async started(job: RouteJob, context: RouteAnalyticsContext): Promise<void> {
    await this.repository.started(this.toStartedRecord(job, context));
  }

  async completed(
    job: RouteJob,
    context: RouteAnalyticsContext,
  ): Promise<void> {
    await this.repository.finished(
      this.toFinishedRecord(job, context, 'completed'),
    );
  }

  async failed(job: RouteJob, context: RouteAnalyticsContext): Promise<void> {
    await this.repository.finished(
      this.toFinishedRecord(job, context, 'failed'),
    );
  }

  async cancelled(
    job: RouteJob,
    context: RouteAnalyticsContext,
  ): Promise<void> {
    await this.repository.finished(
      this.toFinishedRecord(job, context, 'cancelled'),
    );
  }

  private toStartedRecord(
    job: RouteJob,
    context: RouteAnalyticsContext,
  ): RouteAnalyticsStartedRecord {
    const request = job.normalizedRequest ?? normalizeRouteRequest(job.request);
    const createdAt = new Date(job.createdAt);
    const temporal = getRouteTemporalMetadata(request, {
      fallbackTime: createdAt,
      timeZone: this.timeZone,
      isHoliday: this.isHoliday,
      provider: context.provider,
    });
    return {
      createdAt,
      jobId: job.jobId,
      fromKey:
        job.requestMetadata?.fromKey ??
        canonicalizeRouteLocation(request.origin, context.provider),
      toKey:
        job.requestMetadata?.toKey ??
        canonicalizeRouteLocation(request.destination, context.provider),
      mode: request.travelMode,
      dayType: job.requestMetadata?.dayType ?? temporal.dayType,
      timeBucket: job.requestMetadata?.timeBucket ?? temporal.timeBucket,
      provider: job.provider ?? context.provider,
      countryCode: job.countryCode ?? request.countryCode ?? null,
      providerSelectionSource: job.providerSelectionSource ?? 'global-force',
      cacheKey:
        job.cache?.key ??
        context.cacheKey ??
        createRouteCacheKey(request, context.provider, {
          fallbackTime: createdAt,
          timeZone: this.timeZone,
          isHoliday: this.isHoliday,
          provider: context.provider,
        }),
      requestVersion: 1,
    };
  }

  private toFinishedRecord(
    job: RouteJob,
    context: RouteAnalyticsContext,
    status: RouteAnalyticsFinishedRecord['status'],
  ): RouteAnalyticsFinishedRecord {
    const started = this.toStartedRecord(job, context);
    const completedAt = new Date(job.completedAt ?? job.updatedAt);
    const cacheHit = job.cache?.hit ?? null;
    return {
      ...started,
      completedAt,
      cacheHit,
      totalLatencyMs: Math.max(
        0,
        completedAt.getTime() - started.createdAt.getTime(),
      ),
      providerLatencyMs:
        status === 'completed' && cacheHit === true
          ? null
          : (job.providerLatencyMs ?? null),
      status,
      errorCode: status === 'failed' ? (job.error?.code ?? null) : null,
    };
  }
}
