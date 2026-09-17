import {
  Callout,
  Card,
  Classes,
  Divider,
  Intent,
  Tag,
} from '@blueprintjs/core';
import type { ServiceStatus as ServiceStatusData } from '@tcache/common';

import type { CheckState } from '../../api/useTcacheStatus';
import { HealthTag } from '../status/HealthTag';
import { JsonViewer } from './JsonViewer';
import { SectionHeader } from './SectionHeader';

interface CacheDetailProps {
  title: string;
  description: string;
  endpoint: string;
  systemState: CheckState;
  serverState: CheckState;
  service: ServiceStatusData | null;
  placeholder: string;
  example: unknown;
}

function redisState(
  service: ServiceStatusData | null,
  server: CheckState,
): CheckState {
  if (service?.redis === 'ok') return 'online';
  if (service?.redis === 'error') return 'offline';
  return server === 'checking' ? 'checking' : 'offline';
}

export function CacheDetail({
  title,
  description,
  endpoint,
  systemState,
  serverState,
  service,
  placeholder,
  example,
}: CacheDetailProps) {
  return (
    <div className="cache-detail">
      <div className="panel-heading detail-heading">
        <div>
          <h1 className={Classes.HEADING}>{title} Detail</h1>
          <span className={Classes.TEXT_MUTED}>Developer workspace</span>
        </div>
        <HealthTag state={systemState} />
      </div>
      <Divider />

      <div className="detail-content">
        <Card className="detail-section" compact>
          <SectionHeader title="Overview" description={description} />
          <dl className="fact-grid">
            <div>
              <dt>API endpoint</dt>
              <dd>
                <Tag className={Classes.MONOSPACE_TEXT} icon="link" minimal>
                  GET {endpoint}
                </Tag>
              </dd>
            </div>
            <div>
              <dt>Server</dt>
              <dd>
                <HealthTag state={serverState} />
              </dd>
            </div>
            <div>
              <dt>Redis</dt>
              <dd>
                <HealthTag state={redisState(service, serverState)} />
              </dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{service?.environment ?? '—'}</dd>
            </div>
          </dl>
        </Card>

        <div className="detail-section-grid">
          <Card className="detail-section" compact>
            <SectionHeader
              title="Request"
              description="Normalized cache input"
            />
            <Callout compact icon="info-sign">
              No request selected. Future entries will expose normalized keys
              and input.
            </Callout>
          </Card>
          <Card className="detail-section" compact>
            <SectionHeader
              title="Cache Result"
              description="HIT / MISS and TTL"
            />
            <Callout compact icon="database" intent={Intent.NONE}>
              Cache result inspection is not implemented yet.
            </Callout>
          </Card>
          <Card className="detail-section" compact>
            <SectionHeader
              title="Provider Response"
              description="Upstream payload"
            />
            <Callout compact icon="cloud">
              Provider integration is outside the initial setup scope.
            </Callout>
          </Card>
          <Card className="detail-section" compact>
            <SectionHeader
              title="Metadata"
              description="Latency, TTL and timestamps"
            />
            <Callout compact icon="properties">
              Metadata will appear after cache APIs are implemented.
            </Callout>
          </Card>
        </div>

        <Card className="detail-section" compact>
          <Callout compact intent={Intent.PRIMARY} title="Placeholder">
            {placeholder}
          </Callout>
          <JsonViewer title="Expected debug payload" value={example} />
        </Card>
      </div>
    </div>
  );
}
