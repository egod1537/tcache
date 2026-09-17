import {
  Button,
  Callout,
  Card,
  Classes,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { useEffect, useRef, useState } from 'react';

import {
  ApiRequestError,
  computeGoogleRoute,
  type GoogleProviderComputeResponse,
  type GoogleRouteProviderResult,
  type NormalizedRoute,
} from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';
import { NewRouteJobDialog } from '../components/NewRouteJobDialog';
import { RouteMapPanel } from '../components/RouteMapPanel';

interface PlaygroundError {
  httpStatus: number | null;
  code: string;
  message: string;
  details?: unknown;
}

export function RoutePlaygroundPage({ dark }: { dark: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<unknown>(null);
  const [response, setResponse] =
    useState<GoogleProviderComputeResponse | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [error, setError] = useState<PlaygroundError | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  async function run(request: unknown) {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setDialogOpen(false);
    setRunning(true);
    setSubmittedRequest(request);
    setResponse(null);
    setError(null);
    setSelectedRouteIndex(0);

    try {
      setResponse(await computeGoogleRoute(request, controller.signal));
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(toPlaygroundError(requestError));
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setRunning(false);
      }
    }
  }

  const providerResult = parseGoogleResult(response?.result);
  const selectedRoute = providerResult?.routes[selectedRouteIndex];

  return (
    <main className="route-tool-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>Google Routes Playground</h1>
          <p className={Classes.TEXT_MUTED}>
            Verify request normalization, Google mapping, provider calls, and
            response parsing without Jobs or cache.
          </p>
        </div>
        <Button
          icon="play"
          intent={Intent.PRIMARY}
          loading={running}
          onClick={() => setDialogOpen(true)}
        >
          Run Route
        </Button>
      </div>

      <Callout
        icon="wrench"
        intent={Intent.PRIMARY}
        title="Direct provider call"
      >
        Requests go directly through normalization and the Google Routes
        provider. No Job is created, and Redis cache, SSE, and PostgreSQL
        Analytics are not used.
      </Callout>

      {running && (
        <Card className="route-tool-loading" compact>
          <Spinner size={32} />
          Calling Google Routes…
        </Card>
      )}

      {error && <ProviderError error={error} request={submittedRequest} />}

      {response && providerResult && (
        <>
          <Card className="route-tool-result" compact>
            <div className="route-playground-result-heading">
              <div>
                <h2 className={Classes.HEADING}>Provider</h2>
                <p className={Classes.TEXT_MUTED}>
                  Direct Google Routes API response
                </p>
              </div>
              <Tag intent={Intent.SUCCESS}>GOOGLE</Tag>
            </div>
            <dl className="fact-grid route-playground-facts">
              <Fact label="Provider" value={response.provider} />
              <Fact
                label="HTTP status"
                value={providerResult.debug.httpStatus}
              />
              <Fact
                label="Latency"
                value={`${providerResult.debug.latencyMs} ms`}
              />
              <Fact label="Route count" value={providerResult.routes.length} />
            </dl>
          </Card>

          <Card className="route-tool-result" compact>
            <h2 className={Classes.HEADING}>Result</h2>
            {providerResult.routes.length > 0 ? (
              <>
                <RouteSelector
                  onSelect={setSelectedRouteIndex}
                  routes={providerResult.routes}
                  selectedIndex={selectedRouteIndex}
                />
                {selectedRoute && <RouteSummary route={selectedRoute} />}
              </>
            ) : (
              <Callout compact icon="info-sign">
                Google returned no routes for this request.
              </Callout>
            )}
          </Card>

          {selectedRoute && (
            <Card className="route-tool-result" compact>
              <div className="route-playground-result-heading">
                <div>
                  <h2 className={Classes.HEADING}>Map</h2>
                  <p className={Classes.TEXT_MUTED}>
                    Route {selectedRouteIndex + 1} polyline and waypoints
                  </p>
                </div>
              </div>
              <RouteMapPanel route={selectedRoute} />
            </Card>
          )}

          <Card className="route-tool-result route-debug-section" compact>
            <h2 className={Classes.HEADING}>Debug</h2>
            <details open>
              <summary>Request normalization and Google mapping</summary>
              <JsonViewer title="Submitted request" value={submittedRequest} />
              <JsonViewer
                title="Normalized request"
                value={response.normalizedRequest}
              />
              <JsonViewer
                title="Google request body"
                value={providerResult.debug.request}
              />
              <JsonViewer
                title="Field mask"
                value={providerResult.debug.fieldMask}
              />
            </details>
            <details>
              <summary>Normalized result</summary>
              <JsonViewer
                title="Normalized routes"
                value={providerResult.routes}
              />
            </details>
            <details>
              <summary>Raw Google response</summary>
              <JsonViewer
                title="Raw Google response"
                value={providerResult.raw}
              />
            </details>
          </Card>
        </>
      )}

      {!running && !error && !response && (
        <Card className="route-tool-empty" compact>
          <p className={Classes.TEXT_MUTED}>
            Run a request to inspect the direct Google provider response.
          </p>
        </Card>
      )}

      <NewRouteJobDialog
        creating={running}
        dark={dark}
        description="Send this request directly to the Google provider. Jobs, Redis cache, SSE, and Analytics are bypassed."
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={run}
        submitLabel="Run Route"
        title="Google Routes Request"
      />
    </main>
  );
}

function RouteSelector({
  routes,
  selectedIndex,
  onSelect,
}: {
  routes: NormalizedRoute[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="route-result-selector" aria-label="Route selection">
      {routes.map((route, index) => (
        <button
          aria-pressed={selectedIndex === index}
          className="route-result-option"
          key={`${index}-${route.encodedPolyline.slice(0, 16)}`}
          onClick={() => onSelect(index)}
          type="button"
        >
          <strong>Route {index + 1}</strong>
          <span>{formatDuration(route.durationSeconds)}</span>
          <small>{formatDistance(route.distanceMeters)}</small>
        </button>
      ))}
    </div>
  );
}

function RouteSummary({ route }: { route: NormalizedRoute }) {
  return (
    <div className="route-result-summary">
      <dl className="fact-grid route-playground-facts">
        <Fact label="Distance" value={formatDistance(route.distanceMeters)} />
        <Fact label="Duration" value={formatDuration(route.durationSeconds)} />
        <Fact label="Legs" value={route.legs.length} />
        <Fact label="Path points" value={route.path.length} />
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

function ProviderError({
  error,
  request,
}: {
  error: PlaygroundError;
  request: unknown;
}) {
  const upstream = readUpstreamError(error.details);
  return (
    <Card className="route-tool-result route-provider-error" compact>
      <Callout intent={Intent.DANGER} title={error.code}>
        {error.message}
      </Callout>
      <dl className="fact-grid route-playground-facts">
        <Fact label="Endpoint HTTP" value={error.httpStatus ?? '—'} />
        <Fact label="Error code" value={error.code} />
        <Fact label="Upstream HTTP" value={upstream?.httpStatus ?? '—'} />
        <Fact label="Google status" value={upstream?.status ?? '—'} />
      </dl>
      <details open>
        <summary>Request and upstream error details</summary>
        <JsonViewer title="Submitted request" value={request} />
        {error.details !== undefined && (
          <JsonViewer title="Upstream details" value={error.details} />
        )}
      </details>
    </Card>
  );
}

function readUpstreamError(details: unknown): {
  httpStatus?: number | null;
  status?: string | null;
} | null {
  if (typeof details !== 'object' || details === null) return null;
  const upstream = (details as { upstream?: unknown }).upstream;
  return typeof upstream === 'object' && upstream !== null
    ? (upstream as { httpStatus?: number | null; status?: string | null })
    : null;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function parseGoogleResult(
  value: GoogleRouteProviderResult | undefined,
): GoogleRouteProviderResult | null {
  return value?.provider === 'google' && Array.isArray(value.routes)
    ? value
    : null;
}

function toPlaygroundError(error: unknown): PlaygroundError {
  if (error instanceof ApiRequestError) {
    return {
      httpStatus: error.status,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  return {
    httpStatus: null,
    code: 'REQUEST_ERROR',
    message: error instanceof Error ? error.message : 'Route request failed',
  };
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
