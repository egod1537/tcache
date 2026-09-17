import {
  Button,
  Callout,
  Card,
  Classes,
  Divider,
  Intent,
  NonIdealState,
  ProgressBar,
  Tag,
} from '@blueprintjs/core';
import type { ServiceStatus } from '@tcache/common';
import { useEffect, useState } from 'react';

import type {
  GoogleRouteProviderResult,
  NormalizedRoute,
  RouteJobResult,
  RouteJobStatus,
  RouteJobStreamEventType,
  RouteJobStreamState,
  RouteJobView,
} from '../../apps/testbed/src/api/client';
import type { CheckState } from '../../apps/testbed/src/api/useTcacheStatus';
import { JsonViewer } from '../../apps/testbed/src/components/common/JsonViewer';
import { SectionHeader } from '../../apps/testbed/src/components/common/SectionHeader';
import { HealthTag } from '../../apps/testbed/src/components/status/HealthTag';
import { RouteMapPanel } from './components/RouteMapPanel';

interface RouteDetailProps {
  job: RouteJobView | null;
  result: RouteJobResult | null;
  resultLoading: boolean;
  cancelling: boolean;
  streamState: RouteJobStreamState;
  progressSource: 'sse' | 'polling' | 'none';
  latestEvent: {
    type: RouteJobStreamEventType | 'poll';
    receivedAt: string;
  } | null;
  systemState: CheckState;
  serverState: CheckState;
  service: ServiceStatus | null;
  onCancel: (jobId: string) => void;
}

function statusIntent(status: RouteJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

export function RouteDetail({
  job,
  result,
  resultLoading,
  cancelling,
  streamState,
  progressSource,
  latestEvent,
  systemState,
  serverState,
  service,
  onCancel,
}: RouteDetailProps) {
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  useEffect(() => setSelectedRouteIndex(0), [job?.jobId]);

  if (!job) {
    return (
      <Card className="route-detail-empty" compact elevation={1}>
        <NonIdealState
          description="Create a new request or select an existing Job from the sidebar."
          icon="search"
          title="Select a Route Job"
        />
      </Card>
    );
  }

  const cancellable = job.status === 'queued' || job.status === 'running';
  const redisState: CheckState =
    service?.redis === 'ok'
      ? 'online'
      : service?.redis === 'error'
        ? 'offline'
        : serverState === 'checking'
          ? 'checking'
          : 'offline';
  const googleResult = parseGoogleResult(result?.result);
  const selectedRoute = googleResult?.routes[selectedRouteIndex];

  return (
    <div className="route-job-detail">
      <div className="panel-heading detail-heading">
        <div>
          <h1 className={Classes.HEADING}>Route Job Detail</h1>
          <code className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}>
            {job.jobId}
          </code>
        </div>
        <div className="detail-actions">
          <Tag intent={statusIntent(job.status)}>
            {job.status.toUpperCase()}
          </Tag>
          {cancellable && (
            <Button
              icon="stop"
              intent={Intent.WARNING}
              loading={cancelling}
              onClick={() => onCancel(job.jobId)}
              size="small"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
      <Divider />

      <div className="detail-content">
        {streamState === 'reconnecting' && cancellable && (
          <Callout compact intent={Intent.WARNING} title="SSE reconnecting">
            EventSource is reconnecting. Polling keeps the Job snapshot current
            until SSE reconnects.
          </Callout>
        )}

        {job.error && (
          <Card className="detail-section" compact>
            <Callout intent={Intent.DANGER} title={job.error.code}>
              {job.error.message}
            </Callout>
            {job.error.details !== undefined && (
              <JsonViewer
                title="Upstream error details"
                value={job.error.details}
              />
            )}
          </Card>
        )}

        <Card className="detail-section" compact>
          <SectionHeader title="Overview" description={job.message} />
          <dl className="fact-grid route-overview-facts">
            <Fact label="Job ID" value={job.jobId} />
            <Fact label="Status" value={job.status} />
            <Fact label="Stage" value={job.stage} />
            <Fact label="Progress" value={`${job.progress}%`} />
            <Fact
              label="Created"
              value={new Date(job.createdAt).toLocaleString()}
            />
            <Fact
              label="Updated"
              value={new Date(job.updatedAt).toLocaleString()}
            />
            <Fact
              label="Completed"
              value={
                job.completedAt
                  ? new Date(job.completedAt).toLocaleString()
                  : '—'
              }
            />
            <Fact label="Provider" value={job.provider ?? '—'} />
          </dl>
        </Card>

        <Card className="detail-section" compact>
          <SectionHeader title="Progress" description={job.message} />
          <ProgressBar
            animate={cancellable}
            intent={statusIntent(job.status)}
            stripes={cancellable}
            value={job.progress / 100}
          />
          <dl className="fact-grid route-progress-facts">
            <div>
              <dt>Stage</dt>
              <dd>
                <Tag icon="timeline-events" minimal>
                  {job.stage}
                </Tag>
              </dd>
            </div>
            <Fact label="Progress" value={`${job.progress}%`} />
            <div>
              <dt>Route module</dt>
              <dd>
                <HealthTag state={systemState} />
              </dd>
            </div>
            <div>
              <dt>Redis</dt>
              <dd>
                <HealthTag state={redisState} />
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="detail-section" compact>
          <SectionHeader
            title="SSE"
            description="Live lifecycle transport and fallback state"
          />
          <dl className="fact-grid route-sse-facts">
            <div>
              <dt>Connection</dt>
              <dd>
                <Tag intent={streamIntent(streamState)}>
                  {streamLabel(streamState)}
                </Tag>
              </dd>
            </div>
            <Fact
              label="Progress source"
              value={
                progressSource === 'sse'
                  ? 'SSE'
                  : progressSource === 'polling'
                    ? 'Polling fallback'
                    : '—'
              }
            />
            <Fact label="Latest event" value={latestEvent?.type ?? '—'} />
            <Fact
              label="Received"
              value={
                latestEvent
                  ? new Date(latestEvent.receivedAt).toLocaleTimeString()
                  : '—'
              }
            />
          </dl>
        </Card>

        <Card className="detail-section" compact>
          <SectionHeader
            title="Request"
            description="Submitted input and server normalization"
          />
          <dl className="fact-grid route-request-facts">
            <Fact
              label="From"
              value={
                job.requestMetadata?.fromKey ??
                formatLocation(
                  job.normalizedRequest?.origin ?? job.request.origin,
                )
              }
            />
            <Fact
              label="To"
              value={
                job.requestMetadata?.toKey ??
                formatLocation(
                  job.normalizedRequest?.destination ?? job.request.destination,
                )
              }
            />
            <Fact
              label="Intermediates"
              value={
                job.requestMetadata?.intermediateKeys.length ??
                job.normalizedRequest?.intermediates.length ??
                job.request.intermediates?.length ??
                0
              }
            />
            <Fact label="Mode" value={job.request.travelMode} />
            <Fact
              label="Day type"
              value={job.requestMetadata?.dayType ?? '—'}
            />
            <Fact
              label="Time bucket"
              value={job.requestMetadata?.timeBucket ?? '—'}
            />
          </dl>
          <details className="route-request-json">
            <summary>Submitted request JSON</summary>
            <JsonViewer title="Submitted request" value={job.request} />
          </details>
          <details className="route-request-json">
            <summary>Server normalized request</summary>
            <JsonViewer
              title="Normalized request"
              value={job.normalizedRequest ?? job.request}
            />
          </details>
        </Card>

        <div className="detail-section-grid">
          <Card className="detail-section" compact>
            <SectionHeader
              title="Cache"
              description="Lookup result and policy"
            />
            {job.cache ? (
              <dl className="compact-facts">
                <div>
                  <dt>Result</dt>
                  <dd>
                    <Tag
                      intent={job.cache.hit ? Intent.SUCCESS : Intent.WARNING}
                    >
                      {job.cache.hit ? 'HIT' : 'MISS'}
                    </Tag>
                  </dd>
                </div>
                <Fact label="TTL" value={`${job.cache.ttl}s`} />
                <div>
                  <dt>Key</dt>
                  <dd>
                    <code className={Classes.MONOSPACE_TEXT}>
                      {job.cache.key}
                    </code>
                  </dd>
                </div>
              </dl>
            ) : (
              <Callout compact icon="time">
                Cache lookup has not completed.
              </Callout>
            )}
          </Card>

          <Card className="detail-section" compact>
            <SectionHeader
              title="Provider"
              description="Upstream route source"
            />
            <dl className="compact-facts">
              <Fact label="Provider" value={job.provider ?? '—'} />
              <Fact
                label="Latency"
                value={
                  job.providerLatencyMs === undefined
                    ? '—'
                    : `${job.providerLatencyMs}ms`
                }
              />
            </dl>
          </Card>
        </div>

        <Card className="detail-section" compact>
          <SectionHeader
            title="Route Result"
            description="Normalized provider routes"
          />
          {resultLoading ? (
            <Callout compact icon="time">
              Loading final result…
            </Callout>
          ) : googleResult && googleResult.routes.length ? (
            <>
              <div
                className="route-result-selector"
                aria-label="Route selection"
              >
                {googleResult.routes.map((route, index) => (
                  <button
                    aria-pressed={selectedRouteIndex === index}
                    className="route-result-option"
                    key={`${index}-${route.encodedPolyline.slice(0, 16)}`}
                    onClick={() => setSelectedRouteIndex(index)}
                    type="button"
                  >
                    <strong>Route {index + 1}</strong>
                    <span>{formatDuration(route.durationSeconds)}</span>
                    <small>{formatDistance(route.distanceMeters)}</small>
                  </button>
                ))}
              </div>
              {selectedRoute && <RouteSummary route={selectedRoute} />}
            </>
          ) : result?.result !== undefined ? (
            <Callout compact icon="info-sign">
              This provider result has no Google normalized routes. See Raw
              JSON.
            </Callout>
          ) : (
            <Callout compact icon="info-sign">
              The final result becomes available after the Job completes.
            </Callout>
          )}
        </Card>

        {selectedRoute && (
          <Card className="detail-section" compact>
            <SectionHeader
              title="Map"
              description={`Route ${selectedRouteIndex + 1} polyline and stops`}
            />
            <RouteMapPanel route={selectedRoute} />
          </Card>
        )}

        <Card className="detail-section route-debug-section" compact>
          <SectionHeader
            title="Debug"
            description="Normalized and raw provider diagnostics (API keys are never included)"
          />
          {googleResult && (
            <>
              <details>
                <summary>Normalized result</summary>
                <JsonViewer
                  title="Normalized result"
                  value={googleResult.routes}
                />
              </details>
              <details>
                <summary>Provider request / latency</summary>
                <JsonViewer title="Provider debug" value={googleResult.debug} />
              </details>
              <details>
                <summary>Raw provider response</summary>
                <JsonViewer
                  title="Raw provider response"
                  value={googleResult.raw}
                />
              </details>
            </>
          )}
          {result?.result !== undefined && !googleResult && (
            <JsonViewer title="Raw JSON" value={result.result} />
          )}
        </Card>
      </div>
    </div>
  );
}

function streamIntent(state: RouteJobStreamState) {
  if (state === 'connected') return Intent.SUCCESS;
  if (state === 'reconnecting') return Intent.WARNING;
  return Intent.NONE;
}

function streamLabel(state: RouteJobStreamState) {
  if (state === 'connected') return 'Connected';
  if (state === 'reconnecting') return 'Reconnecting';
  return 'Disconnected';
}

function formatLocation(value: unknown) {
  if (typeof value !== 'object' || value === null) return '—';
  const location = value as Record<string, unknown>;
  if (typeof location.placeId === 'string') return `place:${location.placeId}`;
  if (typeof location.address === 'string') return location.address;
  const latitude = location.latitude ?? location.lat;
  const longitude = location.longitude ?? location.lng;
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? `${latitude}, ${longitude}`
    : '—';
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RouteSummary({ route }: { route: NormalizedRoute }) {
  return (
    <div className="route-result-summary">
      <dl className="fact-grid">
        <Fact label="Distance" value={formatDistance(route.distanceMeters)} />
        <Fact label="Duration" value={formatDuration(route.durationSeconds)} />
        <Fact label="Path points" value={route.path.length} />
        <Fact label="Legs" value={route.legs.length} />
      </dl>
      {route.description && <p>{route.description}</p>}
      {route.legs.length > 0 && (
        <details className="route-leg-details">
          <summary>Leg details ({route.legs.length})</summary>
          <ol>
            {route.legs.map((leg, index) => (
              <li key={index}>
                <strong>Leg {index + 1}</strong> ·{' '}
                {formatDistance(leg.distanceMeters)} ·{' '}
                {formatDuration(leg.durationSeconds)} · {leg.steps.length} steps
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function parseGoogleResult(value: unknown): GoogleRouteProviderResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Partial<GoogleRouteProviderResult>;
  return result.provider === 'google' && Array.isArray(result.routes)
    ? (result as GoogleRouteProviderResult)
    : null;
}

function formatDistance(value: number | null) {
  if (value === null) return '—';
  return value < 1_000
    ? `${Math.round(value).toLocaleString()} m`
    : `${(value / 1_000).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      })} km`;
}

function formatDuration(value: number | null) {
  if (value === null) return '—';
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}
