import type { MatrixRequest } from './matrix-request.js';

export type MatrixJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MatrixJobStage =
  | 'queued'
  | 'normalizing_request'
  | 'building_pairs'
  | 'resolving_routes'
  | 'assembling_matrix'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MatrixJobStats {
  totalPairs: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  providerCalls: number;
}

export interface MatrixJobError {
  code:
    | 'INVALID_MATRIX_REQUEST'
    | 'JOB_NOT_FOUND'
    | 'JOB_NOT_COMPLETED'
    | 'JOB_CANCELLED'
    | 'PAIR_ROUTE_FAILED'
    | 'PROVIDER_ERROR'
    | 'ROUTE_PROVIDER_TIMEOUT'
    | 'INTERNAL_ERROR';
  message: string;
  details?: unknown;
}

export interface MatrixResult {
  jobId: string;
  locations: Array<{ id: string }>;
  durationSeconds: number[][];
  metadata: {
    mode: string;
    departureTime: string;
    totalPairs: number;
    cacheHits: number;
    cacheMisses: number;
    providerCalls: number;
  };
}

export interface MatrixJob {
  jobId: string;
  status: MatrixJobStatus;
  stage: MatrixJobStage;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  request: MatrixRequest;
  stats: MatrixJobStats;
  result?: MatrixResult;
  error?: MatrixJobError;
}

export type MatrixJobEventType =
  'snapshot' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface MatrixJobEvent {
  type: MatrixJobEventType;
  job: MatrixJob;
}

export function isMatrixTerminalStatus(
  status: MatrixJobStatus,
): status is Extract<MatrixJobStatus, 'completed' | 'failed' | 'cancelled'> {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

export function toMatrixJobStatus(job: MatrixJob) {
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
    stats: job.stats,
    ...(job.error ? { error: job.error } : {}),
  };
}
