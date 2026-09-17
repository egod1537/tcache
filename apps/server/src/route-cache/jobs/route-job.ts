import type {
  NormalizedRouteRequest,
  RouteJobRequest,
} from '../types/route.js';

export type RouteJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RouteJobStage =
  | 'queued'
  | 'normalizing_request'
  | 'checking_cache'
  | 'cache_hit'
  | 'cache_miss'
  | 'calling_provider'
  | 'processing_provider_response'
  | 'writing_cache'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RouteJobError {
  code:
    | 'INVALID_REQUEST'
    | 'CACHE_ERROR'
    | 'PROVIDER_ERROR'
    | 'ROUTE_PROVIDER_TIMEOUT'
    | 'JOB_NOT_FOUND'
    | 'JOB_CANCELLED'
    | 'INTERNAL_ERROR';
  message: string;
  details?: unknown;
}

export interface RouteCacheMetadata {
  hit: boolean;
  key: string;
  ttl: number;
}

export interface RouteJob {
  jobId: string;
  status: RouteJobStatus;
  stage: RouteJobStage;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  request: RouteJobRequest;
  normalizedRequest?: NormalizedRouteRequest;
  cache?: RouteCacheMetadata;
  provider?: string;
  result?: unknown;
  error?: RouteJobError;
}

export type RouteJobEventType =
  'snapshot' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface RouteJobEvent {
  type: RouteJobEventType;
  job: RouteJob;
}

export function isTerminalStatus(status: RouteJobStatus) {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

export function toJobStatus(job: RouteJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    request: job.request,
    ...(job.cache ? { cache: job.cache } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}
