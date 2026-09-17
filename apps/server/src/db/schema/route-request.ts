export const ROUTE_REQUEST_MODES = [
  'TRANSIT',
  'WALKING',
  'DRIVING',
  'BICYCLING',
] as const;

export type RouteRequestMode = (typeof ROUTE_REQUEST_MODES)[number];

export const ROUTE_REQUEST_DAY_TYPES = [
  'weekday',
  'saturday',
  'sunday',
  'holiday',
] as const;

export type RouteRequestDayType = (typeof ROUTE_REQUEST_DAY_TYPES)[number];

export const ROUTE_REQUEST_STATUSES = [
  'queued',
  'completed',
  'failed',
  'cancelled',
] as const;

export type RouteRequestStatus = (typeof ROUTE_REQUEST_STATUSES)[number];

export interface RouteRequestDatabaseRow {
  id: string;
  created_at: Date;
  completed_at: Date | null;
  job_id: string;
  from_key: string;
  to_key: string;
  mode: RouteRequestMode;
  day_type: RouteRequestDayType;
  time_bucket: string;
  provider: string | null;
  cache_hit: boolean | null;
  total_latency_ms: number | null;
  provider_latency_ms: number | null;
  status: RouteRequestStatus;
  error_code: string | null;
  cache_key: string | null;
  request_version: number;
}
