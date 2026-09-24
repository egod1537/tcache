import type { DatabaseQueryable } from '../../../apps/server/src/db/client.js';
import {
  ROUTE_REQUEST_DAY_TYPES,
  ROUTE_REQUEST_MODES,
  ROUTE_REQUEST_STATUSES,
} from '../../../apps/server/src/db/schema/route-request.js';
import type {
  RouteAnalyticsFinishedRecord,
  RouteAnalyticsRepository,
  RouteAnalyticsStartedRecord,
} from './types.js';
import type {
  RouteAnalyticsErrorPoint,
  RouteAnalyticsFilter,
  RouteAnalyticsModePoint,
  RouteAnalyticsReader,
  RouteAnalyticsRecentRequest,
  RouteAnalyticsSummary,
  RouteAnalyticsTimeseriesPoint,
  RouteAnalyticsTopRoute,
} from './query-types.js';

export class PostgresRouteAnalyticsRepository
  implements RouteAnalyticsRepository, RouteAnalyticsReader
{
  constructor(private readonly database: DatabaseQueryable) {}

  async started(record: RouteAnalyticsStartedRecord): Promise<void> {
    validateBaseRecord(record);
    await this.database.query(
      `INSERT INTO route_requests (
         created_at, job_id, from_key, to_key, mode, day_type,
         time_bucket, provider, status, cache_key, request_version,
         country_code, provider_selection_source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9, $10, $11, $12)
       ON CONFLICT (job_id) DO UPDATE SET
         created_at = EXCLUDED.created_at,
         from_key = EXCLUDED.from_key,
         to_key = EXCLUDED.to_key,
         mode = EXCLUDED.mode,
         day_type = EXCLUDED.day_type,
         time_bucket = EXCLUDED.time_bucket,
         provider = EXCLUDED.provider,
         country_code = EXCLUDED.country_code,
         provider_selection_source = EXCLUDED.provider_selection_source,
         cache_key = EXCLUDED.cache_key,
         request_version = EXCLUDED.request_version`,
      baseValues(record),
    );
  }

  async finished(record: RouteAnalyticsFinishedRecord): Promise<void> {
    validateFinishedRecord(record);
    await this.database.query(
      `INSERT INTO route_requests (
         created_at, completed_at, job_id, from_key, to_key, mode, day_type,
         time_bucket, provider, cache_hit, total_latency_ms,
         provider_latency_ms, status, error_code, cache_key, request_version,
         country_code, provider_selection_source
       ) VALUES (
         $1, $13, $2, $3, $4, $5, $6, $7,
         $8, $14, $15, $16, $17, $18, $9, $10, $11, $12
       )
       ON CONFLICT (job_id) DO UPDATE SET
         created_at = EXCLUDED.created_at,
         completed_at = EXCLUDED.completed_at,
         from_key = EXCLUDED.from_key,
         to_key = EXCLUDED.to_key,
         mode = EXCLUDED.mode,
         day_type = EXCLUDED.day_type,
         time_bucket = EXCLUDED.time_bucket,
         provider = EXCLUDED.provider,
         country_code = EXCLUDED.country_code,
         provider_selection_source = EXCLUDED.provider_selection_source,
         cache_hit = EXCLUDED.cache_hit,
         total_latency_ms = EXCLUDED.total_latency_ms,
         provider_latency_ms = EXCLUDED.provider_latency_ms,
         status = EXCLUDED.status,
         error_code = EXCLUDED.error_code,
         cache_key = EXCLUDED.cache_key,
         request_version = EXCLUDED.request_version`,
      [
        ...baseValues(record),
        record.completedAt,
        record.cacheHit,
        record.totalLatencyMs,
        record.providerLatencyMs,
        record.status,
        record.errorCode,
      ],
    );
  }

  async summary(filter: RouteAnalyticsFilter): Promise<RouteAnalyticsSummary> {
    const query = buildFilter(filter);
    const result = await this.database.query<SummaryRow>(
      `SELECT
         COUNT(*)::int AS requests,
         COUNT(*) FILTER (WHERE cache_hit = true)::int AS cache_hits,
         COUNT(*) FILTER (WHERE cache_hit = false)::int AS cache_misses,
         COALESCE(
           COUNT(*) FILTER (WHERE cache_hit = true)::double precision /
           NULLIF(COUNT(*) FILTER (WHERE cache_hit IS NOT NULL), 0),
           0
         ) AS cache_hit_rate,
         COUNT(*) FILTER (WHERE cache_hit = false)::int AS provider_calls,
         COALESCE(AVG(total_latency_ms), 0)::double precision AS avg_latency_ms,
         COALESCE(
           COUNT(*) FILTER (WHERE status = 'failed')::double precision /
           NULLIF(COUNT(*), 0),
           0
         ) AS error_rate
       FROM route_requests
       WHERE ${query.where}`,
      query.values,
    );
    const row = result.rows[0];
    return {
      requests: row?.requests ?? 0,
      cacheHits: row?.cache_hits ?? 0,
      cacheMisses: row?.cache_misses ?? 0,
      cacheHitRate: row?.cache_hit_rate ?? 0,
      providerCalls: row?.provider_calls ?? 0,
      avgLatencyMs: Math.round(row?.avg_latency_ms ?? 0),
      errorRate: row?.error_rate ?? 0,
    };
  }

  async timeseries(
    filter: RouteAnalyticsFilter,
    interval: 'hour' | 'day',
  ): Promise<RouteAnalyticsTimeseriesPoint[]> {
    const query = buildFilter(filter);
    const intervalIndex = query.values.push(interval);
    const result = await this.database.query<TimeseriesRow>(
      `SELECT
         date_trunc($${intervalIndex}, created_at) AS time,
         COUNT(*)::int AS requests,
         COUNT(*) FILTER (WHERE cache_hit = true)::int AS cache_hits,
         COUNT(*) FILTER (WHERE cache_hit = false)::int AS cache_misses
       FROM route_requests
       WHERE ${query.where}
       GROUP BY time
       ORDER BY time ASC`,
      query.values,
    );
    return result.rows.map((row) => ({
      time: row.time.toISOString(),
      requests: row.requests,
      cacheHits: row.cache_hits,
      cacheMisses: row.cache_misses,
    }));
  }

  async modes(
    filter: RouteAnalyticsFilter,
  ): Promise<RouteAnalyticsModePoint[]> {
    const query = buildFilter(filter);
    const result = await this.database.query<ModeRow>(
      `SELECT
         mode,
         COUNT(*)::int AS requests,
         COALESCE(
           COUNT(*) FILTER (WHERE cache_hit = true)::double precision /
           NULLIF(COUNT(*) FILTER (WHERE cache_hit IS NOT NULL), 0),
           0
         ) AS cache_hit_rate
       FROM route_requests
       WHERE ${query.where}
       GROUP BY mode
       ORDER BY requests DESC, mode ASC`,
      query.values,
    );
    const rowsByMode = new Map(result.rows.map((row) => [row.mode, row]));
    const modes = filter.mode ? [filter.mode] : ROUTE_REQUEST_MODES;
    return modes.map((mode) => {
      const row = rowsByMode.get(mode);
      return {
        mode,
        requests: row?.requests ?? 0,
        cacheHitRate: row?.cache_hit_rate ?? 0,
      };
    });
  }

  async topRoutes(
    filter: RouteAnalyticsFilter,
    limit: number,
  ): Promise<RouteAnalyticsTopRoute[]> {
    const query = buildFilter(filter);
    const limitIndex = query.values.push(limit);
    const result = await this.database.query<TopRouteRow>(
      `SELECT
         from_key,
         to_key,
         mode,
         COUNT(*)::int AS requests,
         COALESCE(
           COUNT(*) FILTER (WHERE cache_hit = true)::double precision /
           NULLIF(COUNT(*) FILTER (WHERE cache_hit IS NOT NULL), 0),
           0
         ) AS cache_hit_rate,
         COALESCE(AVG(total_latency_ms), 0)::double precision AS avg_latency_ms
       FROM route_requests
       WHERE ${query.where}
       GROUP BY from_key, to_key, mode
       ORDER BY requests DESC, from_key ASC, to_key ASC, mode ASC
       LIMIT $${limitIndex}`,
      query.values,
    );
    return result.rows.map((row) => ({
      fromKey: row.from_key,
      toKey: row.to_key,
      mode: row.mode,
      requests: row.requests,
      cacheHitRate: row.cache_hit_rate,
      avgLatencyMs: Math.round(row.avg_latency_ms),
    }));
  }

  async errors(
    filter: RouteAnalyticsFilter,
  ): Promise<RouteAnalyticsErrorPoint[]> {
    const query = buildFilter(filter);
    const result = await this.database.query<ErrorRow>(
      `SELECT error_code, COUNT(*)::int AS count
       FROM route_requests
       WHERE ${query.where} AND error_code IS NOT NULL
       GROUP BY error_code
       ORDER BY count DESC, error_code ASC`,
      query.values,
    );
    return result.rows.map((row) => ({
      errorCode: row.error_code,
      count: row.count,
    }));
  }

  async recent(
    filter: RouteAnalyticsFilter,
    limit: number,
  ): Promise<RouteAnalyticsRecentRequest[]> {
    const query = buildFilter(filter);
    const limitIndex = query.values.push(limit);
    const result = await this.database.query<RecentRow>(
      `SELECT
         created_at, job_id, from_key, to_key, mode, provider,
         cache_hit, total_latency_ms, status, error_code
       FROM route_requests
       WHERE ${query.where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIndex}`,
      query.values,
    );
    return result.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      jobId: row.job_id,
      fromKey: row.from_key,
      toKey: row.to_key,
      mode: row.mode,
      provider: row.provider,
      cacheHit: row.cache_hit,
      latency: row.total_latency_ms,
      status: row.status,
      errorCode: row.error_code,
    }));
  }
}

interface SummaryRow {
  requests: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  provider_calls: number;
  avg_latency_ms: number;
  error_rate: number;
}

interface TimeseriesRow {
  time: Date;
  requests: number;
  cache_hits: number;
  cache_misses: number;
}

interface ModeRow {
  mode: RouteAnalyticsModePoint['mode'];
  requests: number;
  cache_hit_rate: number;
}

interface TopRouteRow {
  from_key: string;
  to_key: string;
  mode: RouteAnalyticsTopRoute['mode'];
  requests: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
}

interface ErrorRow {
  error_code: string;
  count: number;
}

interface RecentRow {
  created_at: Date;
  job_id: string;
  from_key: string;
  to_key: string;
  mode: RouteAnalyticsRecentRequest['mode'];
  provider: string | null;
  cache_hit: boolean | null;
  total_latency_ms: number | null;
  status: string;
  error_code: string | null;
}

function buildFilter(filter: RouteAnalyticsFilter) {
  const values: unknown[] = [filter.from, filter.to];
  const conditions = ['created_at >= $1', 'created_at < $2'];
  if (filter.mode) {
    values.push(filter.mode);
    conditions.push(`mode = $${values.length}`);
  }
  if (filter.provider) {
    values.push(filter.provider);
    conditions.push(`provider = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  return { values, where: conditions.join(' AND ') };
}

function baseValues(record: RouteAnalyticsStartedRecord) {
  return [
    record.createdAt,
    record.jobId,
    record.fromKey,
    record.toKey,
    record.mode,
    record.dayType,
    record.timeBucket,
    record.provider,
    record.cacheKey,
    record.requestVersion,
    record.countryCode,
    record.providerSelectionSource,
  ];
}

function validateBaseRecord(record: RouteAnalyticsStartedRecord) {
  if (!ROUTE_REQUEST_MODES.includes(record.mode)) {
    throw new Error(`Invalid route analytics mode: ${record.mode}`);
  }
  if (!ROUTE_REQUEST_DAY_TYPES.includes(record.dayType)) {
    throw new Error(`Invalid route analytics day type: ${record.dayType}`);
  }
  if (!/^([01]\d|2[0-3]):[0-5]0$/.test(record.timeBucket)) {
    throw new Error(
      `Invalid route analytics time bucket: ${record.timeBucket}`,
    );
  }
  if (!Number.isInteger(record.requestVersion) || record.requestVersion < 1) {
    throw new Error(
      'Route analytics requestVersion must be a positive integer',
    );
  }
}

function validateFinishedRecord(record: RouteAnalyticsFinishedRecord) {
  validateBaseRecord(record);
  if (!ROUTE_REQUEST_STATUSES.includes(record.status)) {
    throw new Error(`Invalid route analytics status: ${record.status}`);
  }
  for (const [field, value] of [
    ['totalLatencyMs', record.totalLatencyMs],
    ['providerLatencyMs', record.providerLatencyMs],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Route analytics ${field} must be nonnegative`);
    }
  }
}
