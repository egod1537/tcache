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

import type {
  RouteJobResult,
  RouteJobStatus,
  RouteJobView,
} from '../api/client';
import type { CheckState } from '../api/useTcacheStatus';
import { JsonViewer } from '../components/common/JsonViewer';
import { SectionHeader } from '../components/common/SectionHeader';
import { HealthTag } from '../components/status/HealthTag';

interface RouteDetailProps {
  job: RouteJobView | null;
  result: RouteJobResult | null;
  resultLoading: boolean;
  cancelling: boolean;
  streamError: boolean;
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
  streamError,
  systemState,
  serverState,
  service,
  onCancel,
}: RouteDetailProps) {
  if (!job) {
    return (
      <Card className="route-detail-empty" compact elevation={1}>
        <NonIdealState
          description="Create a new Job or select an existing Job from the sidebar."
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
        {streamError && cancellable && (
          <Callout compact intent={Intent.WARNING} title="SSE reconnecting">
            The live connection was interrupted. EventSource will reconnect
            while the Job continues on the server.
          </Callout>
        )}

        {job.error && (
          <Callout intent={Intent.DANGER} title={job.error.code}>
            {job.error.message}
          </Callout>
        )}

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
            <div>
              <dt>Progress</dt>
              <dd>{job.progress}%</dd>
            </div>
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
          <JsonViewer title="Request" value={job.request} />
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
                <div>
                  <dt>TTL</dt>
                  <dd>{job.cache.ttl}s</dd>
                </div>
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
              <div>
                <dt>Provider</dt>
                <dd>{job.provider ?? '—'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(job.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(job.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card className="detail-section" compact>
          {resultLoading ? (
            <Callout compact icon="time">
              Loading final result…
            </Callout>
          ) : result?.result !== undefined ? (
            <JsonViewer title="Result" value={result.result} />
          ) : (
            <Callout compact icon="info-sign">
              The final result becomes available after the Job completes.
            </Callout>
          )}
        </Card>
      </div>
    </div>
  );
}
