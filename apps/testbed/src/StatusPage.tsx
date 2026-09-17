import type { ServiceStatus } from '@tcache/common';

import { useEndpoint } from './common/use-endpoint';

export function StatusPage() {
  const { data, error, loading } = useEndpoint<ServiceStatus>('/api/status');

  return (
    <section className="panel">
      <p className="eyebrow">Deployment</p>
      <h1>tcache status</h1>
      {loading && <p>Checking server status…</p>}
      {error && <p className="bad">Unable to load status: {error}</p>}
      {data && (
        <dl className="details status-grid">
          {Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd className={value === 'error' ? 'bad' : undefined}>
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
