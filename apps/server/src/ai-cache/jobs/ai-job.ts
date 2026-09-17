import type { AiJobRequest, AiRequestMetadata } from '../types/ai.js';

export type AiJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AiJobStage =
  | 'queued'
  | 'normalizing_request'
  | 'checking_cache'
  | 'cache_hit'
  | 'cache_miss'
  | 'selecting_provider'
  | 'calling_provider'
  | 'processing_response'
  | 'writing_cache'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AiJobError {
  code:
    | 'INVALID_REQUEST'
    | 'CACHE_ERROR'
    | 'AI_PROVIDER_ERROR'
    | 'AI_PROVIDER_TIMEOUT'
    | 'MODEL_NOT_SUPPORTED'
    | 'PROVIDER_NOT_SUPPORTED'
    | 'JOB_NOT_FOUND'
    | 'JOB_CANCELLED'
    | 'INTERNAL_ERROR';
  message: string;
  details?: unknown;
}

export interface AiCacheMetadata {
  enabled: boolean;
  hit: boolean;
  key: string;
  ttl: number;
}

export interface AiJob {
  jobId: string;
  status: AiJobStatus;
  stage: AiJobStage;
  progress: number;
  provider: string;
  model: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  request: AiJobRequest;
  requestMetadata: AiRequestMetadata;
  cache?: AiCacheMetadata;
  result?: unknown;
  error?: AiJobError;
}

export type AiJobEventType =
  'snapshot' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface AiJobEvent {
  type: AiJobEventType;
  job: AiJob;
}

export function isTerminalStatus(
  status: AiJobStatus,
): status is Extract<AiJobStatus, 'completed' | 'failed' | 'cancelled'> {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

export function toJobStatus(job: AiJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    provider: job.provider,
    model: job.model,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    requestMetadata: job.requestMetadata,
    ...(job.cache ? { cache: job.cache } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}
