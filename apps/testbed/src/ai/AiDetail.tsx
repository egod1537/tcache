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

import type { AiJobResult, AiJobStatus, AiJobView } from '../api/client';
import type { CheckState } from '../api/useTcacheStatus';
import { JsonViewer } from '../components/common/JsonViewer';
import { SectionHeader } from '../components/common/SectionHeader';
import { HealthTag } from '../components/status/HealthTag';

interface AiDetailProps {
  job: AiJobView | null;
  result: AiJobResult | null;
  resultLoading: boolean;
  cancelling: boolean;
  streamError: boolean;
  systemState: CheckState;
  serverState: CheckState;
  service: ServiceStatus | null;
  onCancel: (jobId: string) => void;
}

function statusIntent(status: AiJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

export function AiDetail({
  job,
  result,
  resultLoading,
  cancelling,
  streamError,
  systemState,
  serverState,
  service,
  onCancel,
}: AiDetailProps) {
  if (!job) {
    return (
      <Card className="route-detail-empty" compact elevation={1}>
        <NonIdealState
          description="Create a new Job or select an existing Job from the sidebar."
          icon="predictive-analysis"
          title="Select an AI Job"
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
          <h1 className={Classes.HEADING}>AI Job Detail</h1>
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
            The live connection was interrupted. The Job continues on the
            server.
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
              <dt>AI module</dt>
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
          <JsonViewer title="Request metadata" value={job.requestMetadata} />
          <Callout compact icon="shield" intent={Intent.NONE}>
            Raw prompts are intentionally omitted from Job status and SSE
            payloads.
          </Callout>
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
                  <dt>Mode</dt>
                  <dd>{job.cache.enabled ? 'ENABLED' : 'BYPASSED'}</dd>
                </div>
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
            <SectionHeader title="Provider" description="Upstream AI model" />
            <dl className="compact-facts">
              <div>
                <dt>Provider</dt>
                <dd>{job.provider}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{job.model}</dd>
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
