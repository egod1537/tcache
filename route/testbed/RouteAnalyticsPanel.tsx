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
import { routeJobStatusLabel, routeModeLabel } from './route-ui-labels';

type PeriodPreset = '24h' | '7d' | '30d';

interface RouteAnalyticsPanelProps {
  onSelectJob: (jobId: string) => void;
}

const PERIODS: Record<PeriodPreset, { label: string; hours: number }> = {
  '24h': { label: '최근 24시간', hours: 24 },
  '7d': { label: '최근 7일', hours: 24 * 7 },
  '30d': { label: '최근 30일', hours: 24 * 30 },
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
          reason instanceof Error
            ? reason.message
            : '분석 요청에 실패했습니다.',
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
          <h1 className={Classes.HEADING}>경로 분석</h1>
          <p className={Classes.TEXT_MUTED}>
            PostgreSQL 요청 이력과 캐시 성능을 확인합니다.
          </p>
        </div>
        <Button
          icon="refresh"
          loading={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          새로고침
        </Button>
      </div>

      <Card className="analytics-filter-card" compact>
        <label>
          <span>기간</span>
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
          <span>이동 수단</span>
          <HTMLSelect
            onChange={(event) =>
              setMode(event.currentTarget.value as RouteTravelMode | '')
            }
            value={mode}
          >
            <option value="">전체 이동 수단</option>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {routeModeLabel(value)}
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
            <option value="">전체 Provider</option>
            <option value="google">Google</option>
            <option value="mock">Mock</option>
          </HTMLSelect>
        </label>
        <label>
          <span>상태</span>
          <HTMLSelect
            onChange={(event) =>
              setStatus(event.currentTarget.value as RouteJobStatus | '')
            }
            value={status}
          >
            <option value="">전체 상태</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {routeJobStatusLabel(value)}
              </option>
            ))}
          </HTMLSelect>
        </label>
      </Card>

      {error && (
        <Callout intent={Intent.DANGER} title="분석을 사용할 수 없습니다">
          {error} 작업 탭은 계속 사용할 수 있습니다.
        </Callout>
      )}

      {loading && !data ? (
        <Card className="analytics-loading" compact>
          <Spinner size={32} />
          <span>경로 분석을 불러오는 중…</span>
        </Card>
      ) : data ? (
        <>
          <section aria-label="분석 요약" className="analytics-summary">
            <SummaryCard
              label="요청 수"
              value={formatNumber(data.summary.requests)}
            />
            <SummaryCard
              label="캐시 적중률"
              value={formatPercent(data.summary.cacheHitRate)}
            />
            <SummaryCard
              label="Provider 호출 수"
              value={formatNumber(data.summary.providerCalls)}
            />
            <SummaryCard
              label="평균 응답 시간"
              value={`${formatNumber(data.summary.avgLatencyMs)} ms`}
            />
            <SummaryCard
              intent={data.summary.errorRate > 0 ? Intent.DANGER : Intent.NONE}
              label="오류율"
              value={formatPercent(data.summary.errorRate)}
            />
          </section>

          <section className="analytics-chart-grid">
            <Card className="analytics-section" compact>
              <SectionHeader
                description="선택한 시간 간격별 전체 요청 수"
                title="시간대별 요청"
              />
              <RequestsChart points={data.points} />
            </Card>
            <Card className="analytics-section" compact>
              <SectionHeader
                description="시간대별 Redis 캐시 처리 결과"
                title="캐시 적중 / 미적중"
              />
              <CacheBars points={data.points} />
            </Card>
          </section>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="이동 수단별 요청량과 캐시 효율"
              title="이동 수단별 분석"
            />
            <ModeBreakdown modes={data.modes} />
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="가장 자주 요청된 정규화 위치 조합"
              title="자주 요청된 경로"
            />
            <div className="analytics-table-scroll">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>출발지</th>
                    <th>도착지</th>
                    <th>이동 수단</th>
                    <th>요청 수</th>
                    <th>적중률</th>
                    <th>평균 응답 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {data.routes.map((route) => (
                    <tr key={`${route.fromKey}-${route.toKey}-${route.mode}`}>
                      <KeyCell value={route.fromKey} />
                      <KeyCell value={route.toKey} />
                      <td>{routeModeLabel(route.mode)}</td>
                      <td>{formatNumber(route.requests)}</td>
                      <td>{formatPercent(route.cacheHitRate)}</td>
                      <td>{formatNumber(route.avgLatencyMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
              {!data.routes.length && <TableEmpty label="경로가 없습니다" />}
            </div>
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="최근 요청 정보이며 작업 ID를 선택하면 상세 화면이 열립니다"
              title="최근 요청"
            />
            <div className="analytics-table-scroll">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>작업 ID</th>
                    <th>출발지</th>
                    <th>도착지</th>
                    <th>이동 수단</th>
                    <th>캐시</th>
                    <th>응답 시간</th>
                    <th>상태</th>
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
                      <td>{routeModeLabel(request.mode)}</td>
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
              {!data.recent.length && (
                <TableEmpty label="최근 요청이 없습니다" />
              )}
            </div>
          </Card>

          <Card className="analytics-section" compact>
            <SectionHeader
              description="정규화된 오류 코드만 표시하며 Upstream 메시지는 제외합니다"
              title="오류"
            />
            <div className="analytics-table-scroll analytics-errors-table">
              <HTMLTable compact striped>
                <thead>
                  <tr>
                    <th>코드</th>
                    <th>건수</th>
                    <th>비율</th>
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
              {!errorTotal && (
                <TableEmpty label="이 기간에 발생한 오류가 없습니다" />
              )}
            </div>
          </Card>
        </>
      ) : (
        <Card className="analytics-loading" compact>
          <NonIdealState
            description="새로고침하여 PostgreSQL 분석을 불러오세요."
            icon="chart"
            title="분석 데이터가 없습니다"
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
        aria-label="시간대별 요청 선 그래프"
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
            <title>{`${formatDateTime(point.time)}: 요청 ${formatNumber(point.requests)}건`}</title>
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
              title={`${formatDateTime(point.time)} — 적중 ${point.cacheHits} / 미적중 ${point.cacheMisses}`}
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
          <i className="analytics-legend-hit" /> 적중
        </span>
        <span>
          <i className="analytics-legend-miss" /> 미적중
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
      description="선택한 필터와 일치하는 데이터가 없습니다."
      icon="timeline-line-chart"
      title="시계열 데이터가 없습니다"
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
            <strong>{routeModeLabel(item.mode)}</strong>
            <span className={Classes.TEXT_MUTED}>
              요청 {formatNumber(item.requests)}건 · 적중률{' '}
              {formatPercent(item.cacheHitRate)}
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
  if (value === null) return <Tag minimal>대기 중</Tag>;
  return (
    <Tag intent={value ? Intent.SUCCESS : Intent.WARNING} minimal>
      {value ? '적중' : '미적중'}
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
  return <Tag intent={intent}>{routeJobStatusLabel(status)}</Tag>;
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatChartTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortJobId(jobId: string) {
  return jobId.length > 18 ? `${jobId.slice(0, 15)}…` : jobId;
}
