import {
  Button,
  Callout,
  Card,
  Classes,
  Divider,
  Intent,
  NonIdealState,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
  type TabId,
} from '@blueprintjs/core';
import type { ServiceStatus } from '@tcache/common';
import { useState } from 'react';

import type { AiJobResult, AiJobView } from '../../apps/testbed/src/api/client';
import type { CheckState } from '../../apps/testbed/src/api/useTcacheStatus';
import { JsonViewer } from '../../apps/testbed/src/components/common/JsonViewer';
import { SectionHeader } from '../../apps/testbed/src/components/common/SectionHeader';
import { HealthTag } from '../../apps/testbed/src/components/status/HealthTag';
import { AiEventTimeline } from './components/AiEventTimeline';
import { eventEntries, type AiStreamState } from './ai-job-stream';
import {
  connectionIntent,
  connectionLabel,
  statusIntent,
} from './ai-job-labels';

type AiDetailTab = 'overview' | 'request' | 'result' | 'timeline' | 'raw';

interface AiDetailProps {
  job: AiJobView | null;
  result: AiJobResult | null;
  resultLoading: boolean;
  cancelling: boolean;
  stream: AiStreamState;
  systemState: CheckState;
  serverState: CheckState;
  service: ServiceStatus | null;
  onCancel: (jobId: string) => void;
}

export function AiDetail({
  job,
  result,
  resultLoading,
  cancelling,
  stream,
  systemState,
  serverState,
  service,
  onCancel,
}: AiDetailProps) {
  const [tab, setTab] = useState<AiDetailTab>('overview');

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

  const displayError = result?.error ?? job.error;
  const events = eventEntries(stream.entries);
  const latestEvent = events[events.length - 1];
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
        {stream.connection === 'reconnecting' && cancellable && (
          <Callout compact intent={Intent.WARNING} title="SSE reconnecting">
            The live connection was interrupted. This does not affect the Job,
            which continues on the server.
          </Callout>
        )}
        {stream.connection === 'disconnected' && cancellable && (
          <Callout compact intent={Intent.WARNING} title="SSE disconnected">
            Live updates stopped before the Job finished. The Job status shown
            may be stale; the Job itself is unaffected.
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
          <SectionHeader
            title="SSE connection"
            description="Browser event stream state. Independent of Job status."
          />
          <dl className="fact-grid route-sse-facts" data-testid="ai-sse-facts">
            <div>
              <dt>Connection</dt>
              <dd>
                <Tag intent={connectionIntent(stream.connection)}>
                  {connectionLabel(stream.connection)}
                </Tag>
              </dd>
            </div>
            <div>
              <dt>Connections opened</dt>
              <dd>{stream.connectionCount}</dd>
            </div>
            <div>
              <dt>Last event</dt>
              <dd>
                {latestEvent
                  ? `${latestEvent.eventType} @ ${new Date(
                      latestEvent.receivedAt,
                    ).toLocaleTimeString([], { hour12: false })}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </Card>

        <Tabs
          id="ai-detail-tabs"
          onChange={(next: TabId) => setTab(next as AiDetailTab)}
          renderActiveTabPanelOnly
          selectedTabId={tab}
        >
          <Tab
            id="overview"
            panel={
              <div className="detail-section-grid ai-tab-panel">
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
                            intent={
                              job.cache.hit ? Intent.SUCCESS : Intent.WARNING
                            }
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
                    description="Upstream AI model"
                  />
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
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        {job.completedAt
                          ? new Date(job.completedAt).toLocaleString()
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </div>
            }
            title="Overview"
          />
          <Tab
            id="request"
            panel={
              <Card className="detail-section ai-tab-panel" compact>
                {result?.request ? (
                  <JsonViewer title="Request" value={result.request} />
                ) : (
                  <>
                    <JsonViewer
                      title="Request metadata"
                      value={job.requestMetadata}
                    />
                    <Callout compact icon="shield" intent={Intent.NONE}>
                      Raw prompts are omitted from Job status and SSE payloads
                      and become visible here through the result endpoint.
                    </Callout>
                  </>
                )}
              </Card>
            }
            title="Request"
          />
          <Tab
            id="result"
            panel={
              <Card className="detail-section ai-tab-panel" compact>
                {resultLoading ? (
                  <Callout compact icon="time">
                    Loading final result…
                  </Callout>
                ) : displayError ? (
                  <>
                    <Callout intent={Intent.DANGER} title={displayError.code}>
                      {displayError.message}
                    </Callout>
                    {displayError.details !== undefined && (
                      <JsonViewer
                        title="Error details"
                        value={displayError.details}
                      />
                    )}
                  </>
                ) : result?.result !== undefined ? (
                  <>
                    {result.text && (
                      <div className="ai-result-text">
                        <SectionHeader
                          title="Response text"
                          description="Normalized representative text"
                        />
                        <pre>{result.text}</pre>
                      </div>
                    )}
                    <JsonViewer title="Provider result" value={result.result} />
                  </>
                ) : (
                  <Callout compact icon="info-sign">
                    {cancellable
                      ? 'The final result becomes available after the Job completes.'
                      : 'The Job finished without a result payload.'}
                  </Callout>
                )}
              </Card>
            }
            title="Result / Error"
          />
          <Tab
            id="timeline"
            panel={
              <Card className="detail-section ai-tab-panel" compact>
                <AiEventTimeline entries={stream.entries} />
              </Card>
            }
            title={`Timeline (${events.length})`}
          />
          <Tab
            id="raw"
            panel={
              <Card className="detail-section ai-tab-panel" compact>
                <JsonViewer
                  title="Current Job snapshot (latest known Job view)"
                  value={job}
                />
                {resultLoading ? (
                  <Callout compact icon="time">
                    Loading final result…
                  </Callout>
                ) : result ? (
                  <JsonViewer title="Final result payload" value={result} />
                ) : (
                  <Callout compact icon="info-sign">
                    The result endpoint payload is fetched once the Job reaches
                    a terminal state.
                  </Callout>
                )}
                <JsonViewer
                  title="SSE events"
                  value={events.map((entry) => ({
                    receivedAt: entry.receivedAt,
                    event: entry.eventType,
                    connection: entry.connection,
                    payload: entry.payload,
                  }))}
                />
              </Card>
            }
            title="Raw JSON"
          />
        </Tabs>
      </div>
    </div>
  );
}
