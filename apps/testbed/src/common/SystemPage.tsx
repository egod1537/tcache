import type { PingResponse } from '@tcache/common';

import { useEndpoint } from './use-endpoint';

interface SystemPageProps {
  name: string;
  endpoint: '/api/route/ping' | '/api/ai/ping';
  message: string;
}

export function SystemPage({ name, endpoint, message }: SystemPageProps) {
  const { data, error, loading } = useEndpoint<PingResponse>(endpoint);
  const serverStatus = loading
    ? 'Checking…'
    : error
      ? 'Unavailable'
      : data?.status;

  return (
    <section className="panel">
      <p className="eyebrow">Testbed</p>
      <h1>{name}</h1>
      <dl className="details">
        <div>
          <dt>Server status</dt>
          <dd className={error ? 'bad' : 'good'}>{serverStatus}</dd>
        </div>
        <div>
          <dt>API endpoint</dt>
          <dd>
            <code>{endpoint}</code>
          </dd>
        </div>
      </dl>
      <div className="placeholder">{message}</div>
    </section>
  );
}
