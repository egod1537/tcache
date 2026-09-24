import {
  Button,
  Callout,
  Card,
  Classes,
  Intent,
  NonIdealState,
  ProgressBar,
  Tag,
} from '@blueprintjs/core';
import { useEffect, useMemo, useState } from 'react';

import type {
  CreateMatrixJobResponse,
  MatrixJobView,
  MatrixRequest,
  MatrixResult,
  RouteJobStreamState,
} from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';
import { SectionHeader } from '../../../apps/testbed/src/components/common/SectionHeader';
import { routeJobStatusLabel } from '../route-ui-labels';
import { MatrixResultTable } from './MatrixResultTable';
import {
  buildMatrixPairViews,
  buildTrouteRequestPreview,
  formatDuration,
  validateTrouteCompatibility,
} from './matrix-types';
import type { MatrixTimelineEntry, MatrixUiError } from './useMatrixQuery';

function statusIntent(status: MatrixJobView['status']) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

export function MatrixJobDetail({
  job,
  result,
  submittedRequest,
  createResponse,
  resultLoading,
  cancelling,
  error,
  streamState,
  progressSource,
  timeline,
  onCancel,
}: {
  job: MatrixJobView | null;
  result: MatrixResult | null;
  submittedRequest: MatrixRequest | null;
  createResponse: CreateMatrixJobResponse | null;
  resultLoading: boolean;
  cancelling: boolean;
  error: MatrixUiError | null;
  streamState: RouteJobStreamState;
  progressSource: 'sse' | 'polling' | 'none';
  timeline: MatrixTimelineEntry[];
  onCancel: () => void;
}) {
  const now = useNow(job);
  const compatibility = useMemo(
    () => validateTrouteCompatibility(result),
    [result],
  );

  if (!job) {
    return (
      <Card className="matrix-detail-empty" compact elevation={1}>
        <NonIdealState
          description="왼쪽에서 Matrix Query를 실행하면 Job lifecycle이 표시됩니다."
          icon="grid-view"
          title="Matrix Job을 선택하세요"
        />
      </Card>
    );
  }

  const cancellable = job.status === 'queued' || job.status === 'running';
  const elapsed = elapsedTime(job.createdAt, job.completedAt, now);
  const pairs = buildMatrixPairViews(job, result);
  const hitRatio = job.stats.completedPairs
    ? `${Math.round((job.stats.cacheHits / job.stats.completedPairs) * 100)}%`
    : '—';

  return (
    <section className="matrix-job-detail">
      <Card className="matrix-status-card" compact elevation={1}>
        <div className="matrix-status-heading">
          <div>
            <h2 className={Classes.HEADING}>Job / Result</h2>
            <code className={Classes.MONOSPACE_TEXT}>{job.jobId}</code>
          </div>
          <div className="detail-actions">
            <Tag intent={statusIntent(job.status)}>
              {routeJobStatusLabel(job.status)}
            </Tag>
            {cancellable && (
              <Button
                icon="stop"
                intent={Intent.WARNING}
                loading={cancelling}
                onClick={onCancel}
                size="small"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>

        <ProgressBar
          animate={cancellable}
          intent={statusIntent(job.status)}
          stripes={cancellable}
          value={job.progress / 100}
        />
        <div className="matrix-progress-caption">
          <span>{job.message}</span>
          <strong>
            {job.stats.completedPairs} / {job.stats.totalPairs} pairs
          </strong>
        </div>
        <dl className="matrix-status-facts">
          <Fact label="Status" value={job.status} />
          <Fact label="Stage" value={job.stage} />
          <Fact label="Progress" value={`${job.progress}%`} />
          <Fact label="Elapsed" value={elapsed} />
          <Fact label="Created" value={formatTimestamp(job.createdAt)} />
          <Fact label="Updated" value={formatTimestamp(job.updatedAt)} />
          <Fact label="Cache Hit" value={job.stats.cacheHits} />
          <Fact label="Cache Miss" value={job.stats.cacheMisses} />
          <Fact label="Provider Calls" value={job.stats.providerCalls} />
          <Fact label="Hit Ratio" value={hitRatio} />
          <Fact label="Progress Source" value={progressSource} />
          <Fact label="SSE" value={streamState} />
        </dl>
      </Card>

      {(job.error || error) && (
        <Card compact>
          <Callout
            intent={Intent.DANGER}
            title={(job.error ?? error)?.code ?? 'MATRIX_ERROR'}
          >
            <strong>{failedPair(job.error?.details)}</strong>
            <div>{(job.error ?? error)?.message}</div>
          </Callout>
          {(job.error?.details ?? error?.details) !== undefined && (
            <JsonViewer
              title="Error details"
              value={job.error?.details ?? error?.details}
            />
          )}
        </Card>
      )}

      <MatrixResultTable result={result} />
      {resultLoading && (
        <Callout compact icon="time">
          Matrix result를 불러오는 중…
        </Callout>
      )}

      <Card compact>
        <SectionHeader
          title="Pair Progress"
          description="Server의 completedPairs 순서를 기준으로 표시한 debug projection"
        />
        <Callout className="matrix-pair-note" compact icon="info-sign">
          Public contract는 pair별 cache/provider source를 노출하지 않습니다.
          Source는 집계 통계로만 표시하며 pair별 값을 추정하지 않습니다.
        </Callout>
        <div className="matrix-pair-table-wrap">
          <table className="bp6-html-table bp6-html-table-condensed bp6-html-table-striped matrix-pair-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th>Source</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr key={pair.key}>
                  <td>{pair.fromId}</td>
                  <td>{pair.toId}</td>
                  <td>
                    <Tag
                      intent={
                        pair.status === 'completed'
                          ? Intent.SUCCESS
                          : pair.status === 'failed'
                            ? Intent.DANGER
                            : pair.status === 'running'
                              ? Intent.PRIMARY
                              : Intent.NONE
                      }
                      minimal
                    >
                      {pair.status}
                    </Tag>
                  </td>
                  <td>{pair.source}</td>
                  <td>
                    {pair.durationSeconds === null
                      ? '—'
                      : `${formatDuration(pair.durationSeconds)} (${pair.durationSeconds}s)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="matrix-detail-grid">
        <Card compact>
          <SectionHeader title="Result Metadata" />
          <dl className="compact-facts">
            <Fact
              label="Mode"
              value={result?.metadata.mode ?? job.request.mode}
            />
            <Fact
              label="Departure"
              value={
                result?.metadata.departureTime ?? job.request.departureTime
              }
            />
            <Fact label="Total Pairs" value={job.stats.totalPairs} />
            <Fact label="Cache Hits" value={job.stats.cacheHits} />
            <Fact label="Cache Misses" value={job.stats.cacheMisses} />
            <Fact label="Provider Calls" value={job.stats.providerCalls} />
            <Fact label="Elapsed" value={elapsed} />
          </dl>
        </Card>
        <Card compact>
          <SectionHeader
            title="Troute Compatibility"
            description="TravelTimeMatrix conversion prerequisites"
          />
          <Callout
            compact
            icon={compatibility.valid ? 'tick-circle' : 'warning-sign'}
            intent={compatibility.valid ? Intent.SUCCESS : Intent.WARNING}
            title={
              compatibility.valid
                ? 'Valid TravelTimeMatrix'
                : 'Validation incomplete or failed'
            }
          />
          <ul className="matrix-compatibility-list">
            {compatibility.checks.map((check) => (
              <li key={check.label}>
                <span aria-hidden="true">{check.valid ? '✓' : '✗'}</span>{' '}
                {check.label}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="matrix-detail-grid matrix-debug-grid">
        <Card compact>
          <SectionHeader
            title="Timeline"
            description="SSE / polling snapshots"
          />
          <ol className="matrix-timeline">
            {timeline.map((entry) => (
              <li key={entry.key}>
                <time>{formatTime(entry.receivedAt)}</time>
                <Tag minimal>{entry.type}</Tag>
                <span>{entry.message}</span>
              </li>
            ))}
            {!timeline.length && <li>Event를 기다리는 중…</li>}
          </ol>
        </Card>
        <Card compact>
          <SectionHeader title="Raw Contract" />
          <Raw title="Request JSON" value={submittedRequest ?? job.request} />
          <Raw
            title="Troute Optimize Request Preview"
            value={buildTrouteRequestPreview(submittedRequest ?? job.request)}
          />
          <Raw title="Create Job Response" value={createResponse} />
          <Raw title="Latest Job Status JSON" value={job} />
          <Raw title="Result JSON" value={result} />
          <Raw title="Error JSON" value={job.error ?? error} />
        </Card>
      </div>
    </section>
  );
}

function Raw({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="matrix-raw-section">
      <summary>{title}</summary>
      <JsonViewer title={title} value={value} />
    </details>
  );
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

function failedPair(details: unknown) {
  if (!details || typeof details !== 'object') return '';
  const value = details as { fromId?: unknown; toId?: unknown };
  return typeof value.fromId === 'string' && typeof value.toId === 'string'
    ? `${value.fromId} → ${value.toId}`
    : '';
}

function useNow(job: MatrixJobView | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [job?.jobId, job?.status]);
  return now;
}

function elapsedTime(
  createdAt: string,
  completedAt: string | undefined,
  now: number,
) {
  const elapsed = Math.max(
    0,
    (completedAt ? Date.parse(completedAt) : now) - Date.parse(createdAt),
  );
  return elapsed < 1_000 ? `${elapsed}ms` : `${(elapsed / 1_000).toFixed(1)}s`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('ko-KR');
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', {
    hour12: false,
    fractionalSecondDigits: 3,
  });
}
