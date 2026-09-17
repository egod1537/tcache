import type {
  RouteRequestMode,
  RouteRequestStatus,
} from '../../../apps/server/src/db/schema/route-request.js';

export interface RouteAnalyticsFilter {
  from: Date;
  to: Date;
  mode?: RouteRequestMode;
  provider?: string;
  status?: RouteRequestStatus;
}

export interface RouteAnalyticsSummary {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  providerCalls: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface RouteAnalyticsTimeseriesPoint {
  time: string;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface RouteAnalyticsModePoint {
  mode: RouteRequestMode;
  requests: number;
  cacheHitRate: number;
}

export interface RouteAnalyticsTopRoute {
  fromKey: string;
  toKey: string;
  mode: RouteRequestMode;
  requests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
}

export interface RouteAnalyticsErrorPoint {
  errorCode: string;
  count: number;
}

export interface RouteAnalyticsRecentRequest {
  createdAt: string;
  jobId: string;
  fromKey: string;
  toKey: string;
  mode: RouteRequestMode;
  provider: string | null;
  cacheHit: boolean | null;
  latency: number | null;
  status: string;
  errorCode: string | null;
}

export interface RouteAnalyticsReader {
  summary(filter: RouteAnalyticsFilter): Promise<RouteAnalyticsSummary>;
  timeseries(
    filter: RouteAnalyticsFilter,
    interval: 'hour' | 'day',
  ): Promise<RouteAnalyticsTimeseriesPoint[]>;
  modes(filter: RouteAnalyticsFilter): Promise<RouteAnalyticsModePoint[]>;
  topRoutes(
    filter: RouteAnalyticsFilter,
    limit: number,
  ): Promise<RouteAnalyticsTopRoute[]>;
  errors(filter: RouteAnalyticsFilter): Promise<RouteAnalyticsErrorPoint[]>;
  recent(
    filter: RouteAnalyticsFilter,
    limit: number,
  ): Promise<RouteAnalyticsRecentRequest[]>;
}
