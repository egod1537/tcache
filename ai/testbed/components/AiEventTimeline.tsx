import { Callout, Classes, Intent, Tag } from '@blueprintjs/core';

import type { AiJobStreamEventType } from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';
import { SectionHeader } from '../../../apps/testbed/src/components/common/SectionHeader';
import type { AiTimelineEntry } from '../ai-job-stream';
import {
  connectionIntent,
  connectionLabel,
  statusIntent,
} from '../ai-job-labels';

interface AiEventTimelineProps {
  entries: AiTimelineEntry[];
}

function eventIntent(eventType: AiJobStreamEventType) {
  if (eventType === 'completed') return Intent.SUCCESS;
  if (eventType === 'failed') return Intent.DANGER;
  if (eventType === 'cancelled') return Intent.WARNING;
  return Intent.NONE;
}

function formatTime(receivedAt: string) {
  const date = new Date(receivedAt);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(
    date.getMilliseconds(),
  ).padStart(3, '0')}`;
}

export function AiEventTimeline({ entries }: AiEventTimelineProps) {
  return (
    <div className="ai-timeline">
      <SectionHeader
        title="SSE event timeline"
        description="Events received by this browser for the selected Job, oldest first. Local debug data only."
      />
      {entries.length === 0 ? (
        <Callout compact icon="time">
          No SSE events received yet.
        </Callout>
      ) : (
        <ol className="ai-timeline-list">
          {entries.map((entry) =>
            entry.kind === 'connection' ? (
              <li className="ai-timeline-connection" key={entry.id}>
                <span className={Classes.TEXT_MUTED}>
                  {formatTime(entry.receivedAt)}
                </span>
                <Tag intent={connectionIntent(entry.state)} minimal>
                  SSE {connectionLabel(entry.state)}
                </Tag>
              </li>
            ) : (
              <li key={entry.id}>
                <details className="ai-timeline-event">
                  <summary>
                    <span className={Classes.TEXT_MUTED}>
                      {formatTime(entry.receivedAt)}
                    </span>
                    <Tag intent={eventIntent(entry.eventType)}>
                      {entry.eventType}
                    </Tag>
                    {entry.status && (
                      <Tag intent={statusIntent(entry.status)} minimal>
                        {entry.status}
                      </Tag>
                    )}
                    <span>{entry.stage ?? '—'}</span>
                    <span>
                      {entry.progress === undefined
                        ? '—'
                        : `${entry.progress}%`}
                    </span>
                    <span className="ai-timeline-message">
                      {entry.message ?? ''}
                    </span>
                    {entry.connection > 1 && (
                      <Tag minimal title="Received after a reconnect">
                        conn #{entry.connection}
                      </Tag>
                    )}
                  </summary>
                  <JsonViewer
                    title={`${entry.eventType} payload`}
                    value={entry.payload}
                  />
                </details>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
