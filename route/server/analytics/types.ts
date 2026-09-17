import type {
  RouteRequestDayType,
  RouteRequestMode,
  RouteRequestStatus,
} from '../../../apps/server/src/db/schema/route-request.js';

export interface RouteAnalyticsStartedRecord {
  createdAt: Date;
  jobId: string;
  fromKey: string;
  toKey: string;
  mode: RouteRequestMode;
  dayType: RouteRequestDayType;
  timeBucket: string;
  provider: string;
  cacheKey: string;
  requestVersion: number;
}

export interface RouteAnalyticsFinishedRecord extends RouteAnalyticsStartedRecord {
  completedAt: Date;
  cacheHit: boolean | null;
  totalLatencyMs: number;
  providerLatencyMs: number | null;
  status: Exclude<RouteRequestStatus, 'queued'>;
  errorCode: string | null;
}

export interface RouteAnalyticsRepository {
  started(record: RouteAnalyticsStartedRecord): Promise<void>;
  finished(record: RouteAnalyticsFinishedRecord): Promise<void>;
}
