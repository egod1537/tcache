import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  ROUTE_REQUEST_MODES,
  ROUTE_REQUEST_STATUSES,
} from '../../../apps/server/src/db/schema/route-request.js';
import type {
  RouteAnalyticsFilter,
  RouteAnalyticsReader,
} from '../analytics/query-types.js';

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

interface AnalyticsQuery {
  from?: string;
  to?: string;
  mode?: string;
  provider?: string;
  status?: string;
  interval?: string;
  limit?: string;
}

export function registerRouteAnalytics(
  app: FastifyInstance,
  analytics: RouteAnalyticsReader,
) {
  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/summary',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      return analytics.summary(filter);
    },
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/timeseries',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      const interval = request.query.interval ?? 'hour';
      if (interval !== 'hour' && interval !== 'day') {
        return invalid(reply, 'interval must be hour or day');
      }
      return { points: await analytics.timeseries(filter, interval) };
    },
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/modes',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      return { modes: await analytics.modes(filter) };
    },
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/top-routes',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      const limit = parseLimitOrReply(request.query.limit, 20, 100, reply);
      if (!limit) return;
      return { routes: await analytics.topRoutes(filter, limit) };
    },
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/errors',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      return { errors: await analytics.errors(filter) };
    },
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    '/analytics/recent',
    async (request, reply) => {
      const filter = parseFilterOrReply(request.query, reply);
      if (!filter) return;
      const limit = parseLimitOrReply(request.query.limit, 50, 200, reply);
      if (!limit) return;
      return { requests: await analytics.recent(filter, limit) };
    },
  );
}

export function parseRouteAnalyticsFilter(
  query: AnalyticsQuery,
  now = new Date(),
): RouteAnalyticsFilter {
  const to = query.to ? parseDate('to', query.to) : now;
  const from = query.from
    ? parseDate('from', query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_MS);
  if (from >= to) throw new Error('from must be earlier than to');
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new Error('analytics range must not exceed 90 days');
  }

  const mode = query.mode?.trim().toUpperCase();
  if (
    mode &&
    !ROUTE_REQUEST_MODES.includes(mode as (typeof ROUTE_REQUEST_MODES)[number])
  ) {
    throw new Error(`mode must be one of ${ROUTE_REQUEST_MODES.join(', ')}`);
  }
  const provider = query.provider?.trim();
  if (query.provider !== undefined && !provider) {
    throw new Error('provider must not be empty');
  }
  if (provider && provider.length > 100) {
    throw new Error('provider must be at most 100 characters');
  }
  const status = query.status?.trim().toLowerCase();
  if (
    status &&
    !ROUTE_REQUEST_STATUSES.includes(
      status as (typeof ROUTE_REQUEST_STATUSES)[number],
    )
  ) {
    throw new Error(
      `status must be one of ${ROUTE_REQUEST_STATUSES.join(', ')}`,
    );
  }
  return {
    from,
    to,
    ...(mode ? { mode: mode as (typeof ROUTE_REQUEST_MODES)[number] } : {}),
    ...(provider ? { provider } : {}),
    ...(status
      ? { status: status as (typeof ROUTE_REQUEST_STATUSES)[number] }
      : {}),
  };
}

function parseFilterOrReply(
  query: AnalyticsQuery,
  reply: FastifyReply,
): RouteAnalyticsFilter | null {
  try {
    return parseRouteAnalyticsFilter(query);
  } catch (error) {
    invalid(
      reply,
      error instanceof Error ? error.message : 'Invalid analytics query',
    );
    return null;
  }
}

function parseDate(field: 'from' | 'to', value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`${field} must be ISO-8601`);
  return new Date(timestamp);
}

function parseLimitOrReply(
  value: string | undefined,
  fallback: number,
  maximum: number,
  reply: FastifyReply,
): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    invalid(reply, `limit must be an integer between 1 and ${maximum}`);
    return null;
  }
  return parsed;
}

function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: { code: 'INVALID_ANALYTICS_QUERY', message },
  });
}
