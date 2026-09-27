import { setTimeout as delay } from 'node:timers/promises';
import type { CollectedResponse } from '../common/index.js';
import type { JrEastCollectionRequest, JrEastCollector } from './index.js';
import { JrEastPipelineError } from './errors.js';

const OFFICIAL_HOST = 'timetables.jreast.co.jp';

export interface JrEastCollectorOptions {
  requestDelayMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  userAgent: string;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

export interface RequestLogEntry {
  sourceUrl: string;
  attempt: number;
  requestedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: 'SUCCESS' | 'RETRY' | 'FAILED';
  httpStatus?: number;
  error?: string;
}

export class JrEastHttpCollector implements JrEastCollector {
  readonly collectorVersion = 'jr-east-http/1.0.0';
  readonly requestLog: RequestLogEntry[] = [];

  private readonly requestDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private lastRequestStartedAt = 0;

  constructor(private readonly options: JrEastCollectorOptions) {
    if (options.userAgent.trim().length === 0) {
      throw new Error('A descriptive User-Agent is required');
    }
    this.requestDelayMs = options.requestDelayMs ?? 750;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 4_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    if (this.maxAttempts < 1 || this.maxAttempts > 5) {
      throw new Error('maxAttempts must be between 1 and 5');
    }
  }

  async collect(request: JrEastCollectionRequest): Promise<CollectedResponse> {
    assertOfficialUrl(request.sourceUrl);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.applyRequestDelay();
      const requestedAtDate = this.now();
      const started = Date.now();
      this.lastRequestStartedAt = started;
      try {
        const response = await this.fetchImplementation(request.sourceUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': this.options.userAgent,
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        assertOfficialUrl(response.url);
        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          this.logAttempt(
            request,
            attempt,
            requestedAtDate,
            started,
            retryable && attempt < this.maxAttempts ? 'RETRY' : 'FAILED',
            {
              httpStatus: response.status,
              error: error.message,
            },
          );
          if (!retryable || attempt === this.maxAttempts) {
            throw retryable ? error : new NonRetryableHttpError(error.message);
          }
          lastError = error;
          await delay(
            this.backoffMs(attempt, response.headers.get('retry-after')),
          );
          continue;
        }

        const body = new Uint8Array(await response.arrayBuffer());
        this.logAttempt(request, attempt, requestedAtDate, started, 'SUCCESS', {
          httpStatus: response.status,
        });
        return {
          request,
          requestedAt: requestedAtDate.toISOString(),
          httpStatus: response.status,
          contentType:
            response.headers.get('content-type') ?? 'application/octet-stream',
          body,
        };
      } catch (error) {
        lastError = error;
        const existingLog = this.requestLog.at(-1);
        if (
          existingLog?.sourceUrl !== request.sourceUrl ||
          existingLog.attempt !== attempt
        ) {
          this.logAttempt(
            request,
            attempt,
            requestedAtDate,
            started,
            attempt < this.maxAttempts ? 'RETRY' : 'FAILED',
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
        if (error instanceof NonRetryableHttpError) break;
        if (attempt < this.maxAttempts) {
          await delay(this.backoffMs(attempt));
        }
      }
    }

    throw new JrEastPipelineError(
      'FETCH_FAILED',
      `Failed after ${this.maxAttempts} attempts: ${request.sourceUrl}`,
      request.sourceUrl,
      { cause: lastError },
    );
  }

  private async applyRequestDelay(): Promise<void> {
    const waitMs = this.lastRequestStartedAt + this.requestDelayMs - Date.now();
    if (waitMs > 0) await delay(waitMs);
  }

  private backoffMs(attempt: number, retryAfter: string | null = null): number {
    const retryAfterSeconds =
      retryAfter === null ? Number.NaN : Number(retryAfter);
    const requested = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1_000
      : this.initialBackoffMs * 2 ** (attempt - 1);
    return Math.min(Math.max(0, requested), this.maxBackoffMs);
  }

  private logAttempt(
    request: JrEastCollectionRequest,
    attempt: number,
    requestedAt: Date,
    started: number,
    outcome: RequestLogEntry['outcome'],
    details: Pick<RequestLogEntry, 'httpStatus' | 'error'>,
  ): void {
    const completedAt = this.now();
    this.requestLog.push({
      sourceUrl: request.sourceUrl,
      attempt,
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, Date.now() - started),
      outcome,
      ...(details.httpStatus === undefined
        ? {}
        : { httpStatus: details.httpStatus }),
      ...(details.error === undefined ? {} : { error: details.error }),
    });
  }
}

class NonRetryableHttpError extends Error {}

export function assertOfficialUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new JrEastPipelineError(
      'FETCH_FAILED',
      `Invalid source URL: ${value}`,
      value,
      {
        cause: error,
      },
    );
  }
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_HOST) {
    throw new JrEastPipelineError(
      'FETCH_FAILED',
      `Only the official public timetable host is allowed: ${value}`,
      value,
    );
  }
}
