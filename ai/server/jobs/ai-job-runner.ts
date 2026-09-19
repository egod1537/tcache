import { createAiCacheKey } from '../cache/key.js';
import type { AiCachePolicy } from '../cache/policy.js';
import type { AiCacheRepository } from '../cache/repository.js';
import {
  AiProviderSelectionError,
  type AiProviderRegistry,
} from '../providers/provider.js';
import { normalizeAiRequest, toAiRequestMetadata } from '../types/ai.js';
import {
  isTerminalStatus,
  type AiJob,
  type AiJobError,
  type AiJobEventType,
} from './ai-job.js';
import type { AiJobEventBus } from './ai-job-events.js';
import type { AiJobStore } from './ai-job-store.js';

class AiJobStoppedError extends Error {}

/**
 * Node's fetch reports network failures as a bare "fetch failed" and keeps the
 * useful reason (for example ECONNREFUSED) on `cause.code`. Surface that code
 * only, never the cause message, which may include request details.
 */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown AI job error';
  const cause: unknown = error.cause;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? cause.code
      : undefined;
  return typeof causeCode === 'string'
    ? `${error.message} (${causeCode})`
    : error.message;
}

export interface AiJobRunnerOptions {
  store: AiJobStore;
  events: AiJobEventBus;
  cache: AiCacheRepository;
  cachePolicy: AiCachePolicy;
  providers: AiProviderRegistry;
  providerTimeoutMs: number;
}

export class AiJobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly options: AiJobRunnerOptions) {}

  async run(jobId: string): Promise<void> {
    const initial = await this.options.store.get(jobId);
    if (!initial || isTerminalStatus(initial.status)) return;

    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    let errorCode: AiJobError['code'] = 'INTERNAL_ERROR';
    let timedOut = false;

    try {
      await this.transition(jobId, {
        status: 'running',
        stage: 'normalizing_request',
        progress: 5,
        message: 'AI 요청 정규화 중',
      });

      errorCode = 'INVALID_REQUEST';
      const normalizedRequest = normalizeAiRequest(initial.request);
      const cacheKey = createAiCacheKey(normalizedRequest);
      await this.transition(jobId, {
        stage: 'checking_cache',
        progress: 10,
        message: normalizedRequest.cache.enabled
          ? 'AI cache 조회 중'
          : 'AI cache 비활성화됨',
        requestMetadata: toAiRequestMetadata(normalizedRequest),
      });

      errorCode = 'CACHE_ERROR';
      const cached = normalizedRequest.cache.enabled
        ? await this.options.cache.get(cacheKey)
        : null;
      if (cached) {
        await this.transition(jobId, {
          stage: 'cache_hit',
          progress: 100,
          message: 'AI cache hit',
          cache: {
            enabled: true,
            hit: true,
            key: cacheKey,
            ttl: this.options.cachePolicy.ttlSeconds,
          },
          provider: cached.provider,
          model: cached.model,
          result: cached.result,
        });
        await this.complete(jobId, 'Cached AI response ready');
        return;
      }

      await this.transition(jobId, {
        stage: 'cache_miss',
        progress: 20,
        message: normalizedRequest.cache.enabled
          ? 'AI cache miss'
          : 'AI cache bypassed',
        cache: {
          enabled: normalizedRequest.cache.enabled,
          hit: false,
          key: cacheKey,
          ttl: this.options.cachePolicy.ttlSeconds,
        },
      });

      await this.transition(jobId, {
        stage: 'selecting_provider',
        progress: 25,
        message: 'AI provider 선택 중',
      });
      const provider = this.options.providers.select(
        normalizedRequest.provider,
        normalizedRequest.model,
      );

      await this.transition(jobId, {
        stage: 'calling_provider',
        progress: 40,
        message: 'AI provider 응답 대기 중',
      });
      errorCode = 'AI_PROVIDER_ERROR';
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('AI provider timed out'));
      }, this.options.providerTimeoutMs);
      const providerResult = await provider
        .generate(normalizedRequest, controller.signal)
        .finally(() => clearTimeout(timeout));

      await this.transition(jobId, {
        stage: 'processing_response',
        progress: 85,
        message: 'AI provider 응답 처리 중',
        provider: providerResult.provider,
        model: providerResult.model,
      });

      if (normalizedRequest.cache.enabled) {
        await this.transition(jobId, {
          stage: 'writing_cache',
          progress: 95,
          message: 'AI cache 저장 중',
        });
        errorCode = 'CACHE_ERROR';
        await this.options.cache.set(
          cacheKey,
          providerResult,
          this.options.cachePolicy.ttlSeconds,
        );
      }

      await this.complete(jobId, 'AI job completed', {
        result: providerResult.result,
      });
    } catch (error) {
      const current = await this.options.store.get(jobId);
      if (
        error instanceof AiJobStoppedError ||
        current?.status === 'cancelled'
      ) {
        return;
      }
      if (error instanceof AiProviderSelectionError) errorCode = error.code;
      await this.fail(jobId, {
        code: timedOut ? 'AI_PROVIDER_TIMEOUT' : errorCode,
        message: timedOut
          ? `AI provider exceeded ${this.options.providerTimeoutMs}ms timeout`
          : describeError(error),
      });
    } finally {
      this.controllers.delete(jobId);
    }
  }

  async cancel(jobId: string): Promise<AiJob | null> {
    const cancelled = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isTerminalStatus(current.status)) return current;
      const now = new Date().toISOString();
      const next: AiJob = {
        ...current,
        status: 'cancelled',
        stage: 'cancelled',
        message: 'AI job cancelled',
        updatedAt: now,
        completedAt: now,
        error: { code: 'JOB_CANCELLED', message: 'The AI job was cancelled' },
      };
      await this.options.store.save(next);
      return next;
    });
    if (cancelled?.status === 'cancelled') {
      this.controllers.get(jobId)?.abort(new Error('AI job cancelled'));
      await this.options.events.publish(jobId, {
        type: 'cancelled',
        job: cancelled,
      });
    }
    return cancelled;
  }

  private async complete(
    jobId: string,
    message: string,
    patch: Partial<AiJob> = {},
  ) {
    await this.transition(
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
  }

  private async fail(jobId: string, error: AiJobError) {
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
      if (!(transitionError instanceof AiJobStoppedError))
        throw transitionError;
    }
  }

  private async transition(
    jobId: string,
    patch: Partial<AiJob>,
    eventType: AiJobEventType = 'progress',
  ) {
    const job = await this.withJobLock(jobId, async () => {
      const current = await this.options.store.get(jobId);
      if (!current || isTerminalStatus(current.status)) {
        throw new AiJobStoppedError();
      }
      const next: AiJob = {
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

  private async withJobLock<T>(jobId: string, action: () => Promise<T>) {
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
