import {
  Button,
  Callout,
  Card,
  Classes,
  HTMLSelect,
  HTMLTable,
  Intent,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { useEffect, useMemo, useState } from 'react';

import {
  getRouteAnalyticsDashboard,
  type RouteAnalyticsDashboard,
  type RouteAnalyticsFilters,
  type RouteAnalyticsTimeseriesPoint,
  type RouteJobStatus,
  type RouteTravelMode,
} from '../../apps/testbed/src/api/client';
import { SectionHeader } from '../../apps/testbed/src/components/common/SectionHeader';

type PeriodPreset = '24h' | '7d' | '30d';

interface RouteAnalyticsPanelProps {
  onSelectJob: (jobId: string) => void;
}

const PERIODS: Record<PeriodPreset, { label: string; hours: number }> = {
  '24h': { label: 'Last 24 hours', hours: 24 },
  '7d': { label: 'Last 7 days', hours: 24 * 7 },
  '30d': { label: 'Last 30 days', hours: 24 * 30 },
};

const MODES: RouteTravelMode[] = ['TRANSIT', 'WALKING', 'DRIVING', 'BICYCLING'];

const STATUSES: RouteJobStatus[] = [
  'queued',
  'completed',
  'failed',
  'cancelled',
];

export function RouteAnalyticsPanel({ onSelectJob }: RouteAnalyticsPanelProps) {
  const [period, setPeriod] = useState<PeriodPreset>('24h');
  const [mode, setMode] = useState<RouteTravelMode | ''>('');
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState<RouteJobStatus | ''>('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<RouteAnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(
      to.getTime() - PERIODS[period].hours * 60 * 60 * 1_000,
    );
    const filters: RouteAnalyticsFilters = {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(mode ? { mode } : {}),
      ...(provider ? { provider } : {}),
      ...(status ? { status } : {}),
    };

    setLoading(true);
    setError(null);
    void getRouteAnalyticsDashboard(
      filters,
      period === '24h' ? 'hour' : 'day',
      controller.signal,
    )
      .then(setData)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : 'Analytics request failed',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [mode, period, provider, refreshVersion, status]);

  const errorTotal = useMemo(
    () => data?.errors.reduce((total, item) => total + item.count, 0) ?? 0,
    [data?.errors],
  );

  return (
    <main className="route-analytics-workspace">
      <div className="route-analytics-heading">
        <div>
          <h1 className={Classes.HEADING}>Route Analytics</h1>
          <p className={Classes.TEXT_MUTED}>
            PostgreSQL request history and cache performance
          </p>
        </div>
        <Button
          icon="refresh"
          loading={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>

      <Card className="analytics-filter-card" compact>
        <label>
          <span>Period</span>
          <HTMLSelect
            onChange={(event) =>
              setPeriod(event.currentTarget.value as PeriodPreset)
            }
            value={period}
          >
            {Object.entries(PERIODS).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </HTMLSelect>
        </label>
        <label>
          <span>Mode</span>
          <HTMLSelect
            onChange={(event) =>
              setMode(event.currentTarget.value as RouteTravelMode | '')
            }
            value={mode}
          >
            <option value="">All modes</option>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </HTMLSelect>
        </label>
        <label>
          <span>Provider</span>
          <HTMLSelect
            onChange={(event) => setProvider(event.currentTarget.value)}
            value={provider}
          >
            <option value="">All providers</option>
            <option value="google">Google</option>
            <option value="mock">Mock</option>
          </HTMLSelect>
        </label>
        <label>
          <span>Status</span>
          <HTMLSelect
            onChange={(event) =>
              setStatus(event.currentTarget.value as RouteJobStatus | '')
            }
            value={status}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </HTMLSelect>
        </label>
      </Card>

      {error && (
        <Callout intent={Intent.DANGER} title="Analytics unavailable">
          {error}. Jobs remain available in the Jobs tab.
        </Callout>
      )}

      {loading && !data ? (
        <Card className="analytics-loading" compact>
          <Spinner size={32} />
          <span>Loading Route Analytics…</span>
        </Card>
      ) : data ? (
        <>
          <section aria-label="Analytics summary" className="analytics-summary">
            <SummaryCard
              label="Requests"
              value={formatNumber(data.summary.requests)}
            />
            <SummaryCard
              label="Cache Hit Rate"
              value={formatPercent(data.summary.cacheHitRate)}
            />
            <SummaryCard
              label="Provider Calls"
              value={formatNumber(data.summary.providerCalls)}
            />
            <SummaryCard
              label="Avg Latency"
              value={`${formatNumber(data.summary.avgLatencyMs)} ms`}
            />
            <SummaryCard
              intent={data.summary.errorRate > 0 ? Intent.DANGER : Intent.NONE}
              label="Error Rate"
              value={formatPercent(data.summary.errorRate)}
            />
          </section>

          <section className="analytics-chart-grid">
            <Card className="analytics-section" compact>
              <SectionHeader
                description="Total requests grouped by selected interval"
                title="Requests over time"
              />
              <RequestsChart points={data.points} />
            </Card>
            <Card className="analytics-section" compact>
              <SectionHeader
                description="Redis cache decisions over time"
                title="Cache Hit / Miss"
              />
              <CacheBars points={data.points} />
            </Card>
          </section>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="Request volume and cache efficiency"
              title="Mode breakdown"
            />
            <ModeBreakdown modes={data.modes} />
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="Most frequently requested canonical location pairs"
              title="Top Routes"
            />
            <div className="analytics-table-scroll">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Mode</th>
                    <th>Requests</th>
                    <th>Hit Rate</th>
                    <th>Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.routes.map((route) => (
                    <tr key={`${route.fromKey}-${route.toKey}-${route.mode}`}>
                      <KeyCell value={route.fromKey} />
                      <KeyCell value={route.toKey} />
                      <td>{formatLabel(route.mode)}</td>
                      <td>{formatNumber(route.requests)}</td>
                      <td>{formatPercent(route.cacheHitRate)}</td>
                      <td>{formatNumber(route.avgLatencyMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
              {!data.routes.length && <TableEmpty label="No routes found" />}
            </div>
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="Latest request metadata; select a Job ID to open its detail"
              title="Recent Requests"
            />
            <div className="analytics-table-scroll">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Job ID</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Mode</th>
                    <th>Cache</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((request) => (
                    <tr key={request.jobId}>
                      <td>{formatDateTime(request.createdAt)}</td>
                      <td>
                        <Button
                          className="analytics-job-link"
                          onClick={() => onSelectJob(request.jobId)}
                          size="small"
                          variant="minimal"
                        >
                          <code>{shortJobId(request.jobId)}</code>
                        </Button>
                      </td>
                      <KeyCell value={request.fromKey} />
                      <KeyCell value={request.toKey} />
                      <td>{formatLabel(request.mode)}</td>
                      <td>
                        <CacheTag value={request.cacheHit} />
                      </td>
                      <td>
                        {request.latency === null
                          ? '—'
                          : `${formatNumber(request.latency)} ms`}
                      </td>
                      <td>
                        <StatusTag status={request.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
              {!data.recent.length && <TableEmpty label="No recent requests" />}
            </div>
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="Normalized error codes only; upstream messages are excluded"
              title="Errors"
            />
            <div className="analytics-table-scroll analytics-errors-table">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Count</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((item) => (
                    <tr key={item.errorCode}>
                      <td>
                        <code>{item.errorCode}</code>
                      </td>
                      <td>{formatNumber(item.count)}</td>
                      <td>
                        {formatPercent(
                          data.summary.requests
                            ? item.count / data.summary.requests
                            : 0,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
              {!errorTotal && <TableEmpty label="No errors in this period" />}
            </div>
          </Card>
        </>
      ) : (
        <Card className="analytics-loading" compact>
          <NonIdealState
            description="Refresh to load PostgreSQL analytics."
            icon="chart"
            title="No analytics data"
          />
        </Card>
      )}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  intent = Intent.NONE,
}: {
  label: string;
  value: string;
  intent?: Intent;
}) {
  return (
    <Card className="analytics-summary-card" compact>
      <span className={Classes.TEXT_MUTED}>{label}</span>
      <strong
        className={intent === Intent.DANGER ? 'analytics-summary-danger' : ''}
      >
        {value}
      </strong>
    </Card>
  );
}

function RequestsChart({
  points,
}: {
  points: RouteAnalyticsTimeseriesPoint[];
}) {
  if (!points.length) return <ChartEmpty />;
  const width = 640;
  const height = 190;
  const padding = 24;
  const maximum = Math.max(...points.map((point) => point.requests), 1);
  const coordinates = points.map((point, index) => {
    const x =
      points.length === 1
        ? width / 2
        : padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - (point.requests / maximum) * (height - 48);
    return { ...point, x, y };
  });

  return (
    <div className="analytics-chart">
      <svg
        aria-label="Requests over time line chart"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            className="analytics-chart-gridline"
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={height - padding - ratio * (height - 48)}
            y2={height - padding - ratio * (height - 48)}
          />
        ))}
        <polyline
          className="analytics-chart-line"
          fill="none"
          points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')}
        />
        {coordinates.map((point) => (
          <circle
            className="analytics-chart-point"
            cx={point.x}
            cy={point.y}
            key={point.time}
            r="3.5"
          >
            <title>{`${formatDateTime(point.time)}: ${formatNumber(point.requests)} requests`}</title>
          </circle>
        ))}
      </svg>
      <ChartAxis points={points} />
    </div>
  );
}

function CacheBars({ points }: { points: RouteAnalyticsTimeseriesPoint[] }) {
  if (!points.length) return <ChartEmpty />;
  const maximum = Math.max(
    ...points.map((point) => point.cacheHits + point.cacheMisses),
    1,
  );
  return (
    <div className="analytics-chart">
      <div className="analytics-stacked-bars">
        {points.map((point) => {
          const total = point.cacheHits + point.cacheMisses;
          return (
            <div
              className="analytics-stacked-column"
              key={point.time}
              title={`${formatDateTime(point.time)} — ${point.cacheHits} hit / ${point.cacheMisses} miss`}
            >
              <div
                className="analytics-stacked-total"
                style={{ height: `${(total / maximum) * 100}%` }}
              >
                <div
                  className="analytics-cache-hit"
                  style={{
                    height: `${total ? (point.cacheHits / total) * 100 : 0}%`,
                  }}
                />
                <div
                  className="analytics-cache-miss"
                  style={{
                    height: `${total ? (point.cacheMisses / total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <ChartAxis points={points} />
      <div className="analytics-chart-legend">
        <span>
          <i className="analytics-legend-hit" /> Hit
        </span>
        <span>
          <i className="analytics-legend-miss" /> Miss
        </span>
      </div>
    </div>
  );
}

function ChartAxis({ points }: { points: RouteAnalyticsTimeseriesPoint[] }) {
  const labels =
    points.length > 2
      ? [points[0], points[Math.floor(points.length / 2)], points.at(-1)]
      : points;
  return (
    <div className="analytics-chart-axis">
      {labels.map((point) =>
        point ? (
          <span key={point.time}>{formatChartTime(point.time)}</span>
        ) : null,
      )}
    </div>
  );
}

function ChartEmpty() {
  return (
    <NonIdealState
      className="analytics-chart-empty"
      description="No points match the selected filters."
      icon="timeline-line-chart"
      title="No timeseries data"
    />
  );
}

function ModeBreakdown({ modes }: { modes: RouteAnalyticsDashboard['modes'] }) {
  const maximum = Math.max(...modes.map((item) => item.requests), 1);
  return (
    <div className="analytics-mode-grid">
      {modes.map((item) => (
        <div className="analytics-mode-item" key={item.mode}>
          <div>
            <strong>{formatLabel(item.mode)}</strong>
            <span className={Classes.TEXT_MUTED}>
              {formatNumber(item.requests)} requests ·{' '}
              {formatPercent(item.cacheHitRate)} hit
            </span>
          </div>
          <div className="analytics-mode-track">
            <span style={{ width: `${(item.requests / maximum) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyCell({ value }: { value: string }) {
  return (
    <td className="analytics-key-cell" title={value}>
      <code>{value}</code>
    </td>
  );
}

function CacheTag({ value }: { value: boolean | null }) {
  if (value === null) return <Tag minimal>Pending</Tag>;
  return (
    <Tag intent={value ? Intent.SUCCESS : Intent.WARNING} minimal>
      {value ? 'HIT' : 'MISS'}
    </Tag>
  );
}

function StatusTag({ status }: { status: RouteJobStatus }) {
  const intent =
    status === 'completed'
      ? Intent.SUCCESS
      : status === 'failed'
        ? Intent.DANGER
        : status === 'cancelled'
          ? Intent.WARNING
          : Intent.PRIMARY;
  return <Tag intent={intent}>{status.toUpperCase()}</Tag>;
}

function TableEmpty({ label }: { label: string }) {
  return (
    <div className={`${Classes.TEXT_MUTED} analytics-table-empty`}>{label}</div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatChartTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortJobId(jobId: string) {
  return jobId.length > 18 ? `${jobId.slice(0, 15)}…` : jobId;
}
