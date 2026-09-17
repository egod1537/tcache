import {
  Button,
  Callout,
  Card,
  Classes,
  Divider,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';

import type { CheckState, TcacheStatusState } from '../api/useTcacheStatus';
import { SectionHeader } from '../components/common/SectionHeader';
import { ServiceStatus } from '../components/status/ServiceStatus';

interface StatusPageProps {
  status: TcacheStatusState;
}

function redisState(status: TcacheStatusState): CheckState {
  if (status.service?.redis === 'ok') return 'online';
  if (status.service?.redis === 'error') return 'offline';
  return status.server === 'checking' ? 'checking' : 'offline';
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`]
    .filter(Boolean)
    .join(' ');
}

export function StatusPage({ status }: StatusPageProps) {
  const service = status.service;

  return (
    <main className="status-workspace">
      <div className="status-page-heading">
        <div>
          <h1 className={Classes.HEADING}>Infrastructure Status</h1>
          <p className={Classes.TEXT_MUTED}>
            Runtime, module and deployment information for tcache.
          </p>
        </div>
        <Button
          disabled={status.refreshing}
          icon="refresh"
          loading={status.refreshing}
          onClick={() => void status.refresh()}
        >
          Refresh
        </Button>
      </div>

      {status.refreshing && !service && (
        <div className="status-loading" aria-label="Loading status">
          <Spinner size={24} />
          <span>Checking tcache services…</span>
        </div>
      )}

      {status.error && (
        <Callout intent={Intent.DANGER} title="Health check failed">
          {status.error}
        </Callout>
      )}

      <section className="status-section" aria-labelledby="services-title">
        <SectionHeader
          title="Services"
          description="Current process and module availability"
        />
        <div className="service-grid" id="services-title">
          <ServiceStatus
            description="Fastify API and health endpoint"
            endpoint="/health"
            name="tcache-server"
            state={status.server}
          />
          <ServiceStatus
            description="Route cache module"
            endpoint="/api/route/ping"
            name="route-cache"
            state={status.routeCache}
          />
          <ServiceStatus
            description="AI response cache module"
            endpoint="/api/ai/ping"
            name="ai-cache"
            state={status.aiCache}
          />
          <ServiceStatus
            description="Internal cache data store"
            name="redis"
            state={redisState(status)}
          />
        </div>
      </section>

      <section className="status-section" aria-labelledby="deployment-title">
        <SectionHeader
          title="Deployment"
          description="Version reported by the running server"
        />
        <Card className="deployment-card" compact>
          <table
            className={`${Classes.HTML_TABLE} ${Classes.HTML_TABLE_STRIPED}`}
            id="deployment-title"
          >
            <tbody>
              <tr>
                <th scope="row">Environment</th>
                <td>
                  <Tag intent={Intent.PRIMARY} minimal>
                    {service?.environment ?? 'unknown'}
                  </Tag>
                </td>
              </tr>
              <tr>
                <th scope="row">Git commit</th>
                <td>
                  <code className={Classes.MONOSPACE_TEXT}>
                    {service?.version ?? 'unknown'}
                  </code>
                </td>
              </tr>
              <tr>
                <th scope="row">Uptime</th>
                <td>{service ? formatUptime(service.uptime) : '—'}</td>
              </tr>
              <tr>
                <th scope="row">Last checked</th>
                <td>
                  {status.lastCheckedAt
                    ? new Date(status.lastCheckedAt).toLocaleString()
                    : '—'}
                </td>
              </tr>
              <tr>
                <th scope="row">Deploy timestamp</th>
                <td className={Classes.TEXT_MUTED}>
                  Not reported by the server
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </section>

      <section className="status-section" aria-labelledby="endpoints-title">
        <SectionHeader
          title="Endpoints"
          description="Externally routed debug and health paths"
        />
        <Card className="endpoint-card" compact>
          <div className="endpoint-list" id="endpoints-title">
            {[
              ['GET', '/health'],
              ['GET', '/api/route/*'],
              ['GET', '/api/ai/*'],
            ].map(([method, endpoint]) => (
              <div key={endpoint}>
                <Tag intent={Intent.SUCCESS} minimal>
                  {method}
                </Tag>
                <code className={Classes.MONOSPACE_TEXT}>{endpoint}</code>
              </div>
            ))}
          </div>
          <Divider />
          <Callout compact icon="info-sign">
            The testbed proxies API requests to the internal tcache server.
            Redis is not exposed outside Docker.
          </Callout>
        </Card>
      </section>
    </main>
  );
}
