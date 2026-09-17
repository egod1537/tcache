import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  Intent,
  NonIdealState,
  Spinner,
  Tab,
  Tabs,
  type TabId,
} from '@blueprintjs/core';
import { useState } from 'react';

import type {
  GoogleProviderComputeResponse,
  NormalizedRoute,
} from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';
import type { PlaygroundError } from './playground-types';

type ResultTab = 'result' | 'request' | 'response' | 'debug';

export function RouteResultPanel({
  pending,
  error,
  response,
  submittedRequest,
  requestTimestamp,
  selectedRouteIndex,
  onSelectRoute,
}: {
  pending: boolean;
  error: PlaygroundError | null;
  response: GoogleProviderComputeResponse | null;
  submittedRequest: unknown;
  requestTimestamp: string | null;
  selectedRouteIndex: number;
  onSelectRoute: (index: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<ResultTab>('result');
  const result = response?.result ?? null;
  const selectedRoute = result?.routes[selectedRouteIndex];

  return (
    <Card className="route-playground-output" compact elevation={1}>
      <Tabs
        id="route-playground-output-tabs"
        onChange={(tab: TabId) => setActiveTab(tab as ResultTab)}
        selectedTabId={activeTab}
      >
        <Tab
          id="result"
          panel={
            <ResultTabPanel
              error={error}
              onSelectRoute={onSelectRoute}
              pending={pending}
              response={response}
              selectedIndex={selectedRouteIndex}
              selectedRoute={selectedRoute}
            />
          }
          title="Result"
        />
        <Tab
          id="request"
          panel={
            <RequestTabPanel
              response={response}
              submittedRequest={submittedRequest}
            />
          }
          title="Request"
        />
        <Tab
          id="response"
          panel={<ResponseTabPanel response={response} />}
          title="Response"
        />
        <Tab
          id="debug"
          panel={
            <DebugTabPanel
              error={error}
              requestTimestamp={requestTimestamp}
              response={response}
            />
          }
          title="Debug"
        />
      </Tabs>
    </Card>
  );
}

function ResultTabPanel({
  pending,
  error,
  response,
  selectedRoute,
  selectedIndex,
  onSelectRoute,
}: {
  pending: boolean;
  error: PlaygroundError | null;
  response: GoogleProviderComputeResponse | null;
  selectedRoute: NormalizedRoute | undefined;
  selectedIndex: number;
  onSelectRoute: (index: number) => void;
}) {
  if (pending) {
    return (
      <div className="route-playground-output-empty">
        <Spinner size={28} />
        Waiting for Google Routes…
      </div>
    );
  }
  if (error) return <ProviderError error={error} />;
  if (!response) return <OutputEmpty title="No route result" />;

  const result = response.result;
  return (
    <div className="route-playground-tab-content">
      <dl className="fact-grid route-playground-result-facts">
        <Fact label="Provider" value="Google" />
        <Fact label="Latency" value={`${result.debug.latencyMs} ms`} />
        <Fact label="Routes" value={result.routes.length} />
        <Fact
          label="Distance"
          value={formatDistance(selectedRoute?.distanceMeters ?? null)}
        />
        <Fact
          label="Duration"
          value={formatDuration(selectedRoute?.durationSeconds ?? null)}
        />
        <Fact
          label="Selected"
          value={selectedRoute ? `Route ${selectedIndex + 1}` : '—'}
        />
      </dl>

      {result.routes.length > 1 && (
        <ButtonGroup className="route-playground-route-switcher">
          {result.routes.map((route, index) => (
            <Button
              active={selectedIndex === index}
              intent={selectedIndex === index ? Intent.PRIMARY : Intent.NONE}
              key={`${index}-${route.encodedPolyline.slice(0, 12)}`}
              onClick={() => onSelectRoute(index)}
            >
              Route {index + 1}
            </Button>
          ))}
        </ButtonGroup>
      )}

      {selectedRoute?.legs.length ? (
        <div className="route-playground-leg-list">
          <h3 className={Classes.HEADING}>Legs</h3>
          <ol>
            {selectedRoute.legs.map((leg, index) => (
              <li key={index}>
                <strong>Leg {index + 1}</strong>
                <span>{formatDistance(leg.distanceMeters)}</span>
                <span>{formatDuration(leg.durationSeconds)}</span>
                <span>{leg.steps.length} steps</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Callout compact icon="info-sign">
          Google returned no route legs.
        </Callout>
      )}
    </div>
  );
}

function RequestTabPanel({
  response,
  submittedRequest,
}: {
  response: GoogleProviderComputeResponse | null;
  submittedRequest: unknown;
}) {
  if (submittedRequest === null) return <OutputEmpty title="No request sent" />;
  return (
    <div className="route-playground-json-grid">
      <JsonViewer title="Submitted request" value={submittedRequest} />
      <JsonViewer
        title="Normalized request"
        value={response?.normalizedRequest ?? null}
      />
      <JsonViewer
        title="Google provider request"
        value={response?.result.debug.request ?? null}
      />
    </div>
  );
}

function ResponseTabPanel({
  response,
}: {
  response: GoogleProviderComputeResponse | null;
}) {
  if (!response) return <OutputEmpty title="No response received" />;
  return (
    <div className="route-playground-json-grid">
      <JsonViewer
        title="Normalized route result"
        value={response.result.routes}
      />
      <JsonViewer title="Raw Google response" value={response.result.raw} />
    </div>
  );
}

function DebugTabPanel({
  response,
  error,
  requestTimestamp,
}: {
  response: GoogleProviderComputeResponse | null;
  error: PlaygroundError | null;
  requestTimestamp: string | null;
}) {
  const upstream = readUpstream(error?.details);
  return (
    <div className="route-playground-tab-content">
      <dl className="fact-grid route-playground-debug-facts">
        <Fact
          label="Endpoint"
          value="POST /api/route/provider/google/compute"
        />
        <Fact label="Provider" value={response?.provider ?? 'google'} />
        <Fact
          label="Requested"
          value={
            requestTimestamp ? new Date(requestTimestamp).toLocaleString() : '—'
          }
        />
        <Fact
          label="Latency"
          value={response ? `${response.result.debug.latencyMs} ms` : '—'}
        />
        <Fact
          label="Upstream status"
          value={
            response?.result.debug.httpStatus ??
            upstream?.httpStatus ??
            upstream?.status ??
            '—'
          }
        />
        <Fact
          label="Route count"
          value={response?.result.routes.length ?? '—'}
        />
      </dl>
      {response && (
        <JsonViewer
          title="Google field mask"
          value={response.result.debug.fieldMask}
        />
      )}
      {error?.details !== undefined && (
        <JsonViewer title="Normalized upstream error" value={error.details} />
      )}
    </div>
  );
}

function ProviderError({ error }: { error: PlaygroundError }) {
  const upstream = readUpstream(error.details);
  return (
    <div className="route-playground-tab-content">
      <Callout intent={Intent.DANGER} title={error.code}>
        {error.message}
      </Callout>
      <dl className="fact-grid route-playground-error-facts">
        <Fact label="Endpoint HTTP" value={error.httpStatus ?? '—'} />
        <Fact label="Error code" value={error.code} />
        <Fact label="Upstream HTTP" value={upstream?.httpStatus ?? '—'} />
        <Fact label="Google status" value={upstream?.status ?? '—'} />
        <Fact label="Google message" value={upstream?.message ?? '—'} />
      </dl>
      {error.details !== undefined && (
        <JsonViewer title="Upstream details" value={error.details} />
      )}
    </div>
  );
}

function OutputEmpty({ title }: { title: string }) {
  return (
    <div className="route-playground-output-empty">
      <NonIdealState
        description="Run Route to populate this panel."
        icon="route"
        title={title}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function readUpstream(details: unknown): {
  httpStatus?: number | null;
  status?: string | null;
  message?: string | null;
} | null {
  if (typeof details !== 'object' || details === null) return null;
  const upstream = (details as { upstream?: unknown }).upstream;
  return typeof upstream === 'object' && upstream !== null
    ? (upstream as {
        httpStatus?: number | null;
        status?: string | null;
        message?: string | null;
      })
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
