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
  NormalizedRoute,
  RoutePlaygroundResponse,
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
  response: RoutePlaygroundResponse | null;
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
          title="결과"
        />
        <Tab
          id="request"
          panel={
            <RequestTabPanel
              response={response}
              submittedRequest={submittedRequest}
            />
          }
          title="요청"
        />
        <Tab
          id="response"
          panel={<ResponseTabPanel response={response} />}
          title="응답"
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
          title="디버그"
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
  response: RoutePlaygroundResponse | null;
  selectedRoute: NormalizedRoute | undefined;
  selectedIndex: number;
  onSelectRoute: (index: number) => void;
}) {
  if (pending) {
    return (
      <div className="route-playground-output-empty">
        <Spinner size={28} />
        Route Job 응답 대기 중…
      </div>
    );
  }
  if (error) return <ProviderError error={error} />;
  if (!response) return <OutputEmpty title="경로 결과가 없습니다" />;

  const result = response.result;
  return (
    <div className="route-playground-tab-content">
      <dl className="fact-grid route-playground-result-facts">
        <Fact
          label="Provider"
          value={response.selectedProvider ?? response.provider}
        />
        <Fact
          label="응답 시간"
          value={
            response.providerLatencyMs === undefined
              ? '—'
              : `${response.providerLatencyMs} ms`
          }
        />
        <Fact label="경로 수" value={result.routes.length} />
        <Fact
          label="캐시"
          value={response.cache ? (response.cache.hit ? 'hit' : 'miss') : '—'}
        />
        <Fact
          label="거리"
          value={formatDistance(selectedRoute?.distanceMeters ?? null)}
        />
        <Fact
          label="소요 시간"
          value={formatDuration(selectedRoute?.durationSeconds ?? null)}
        />
        <Fact
          label="도보 시간"
          value={formatDuration(readWalkingDuration(selectedRoute))}
        />
        <Fact
          label="환승"
          value={
            selectedRoute?.transferCount === null ||
            selectedRoute?.transferCount === undefined
              ? '—'
              : `${selectedRoute.transferCount}회`
          }
        />
        <Fact
          label="출발"
          value={formatDateTime(selectedRoute?.departureTime)}
        />
        <Fact label="도착" value={formatDateTime(selectedRoute?.arrivalTime)} />
        <Fact
          label="선택한 경로"
          value={selectedRoute ? `경로 ${selectedIndex + 1}` : '—'}
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
              경로 {index + 1}
            </Button>
          ))}
        </ButtonGroup>
      )}

      {selectedRoute?.legs.length ? (
        <div className="route-playground-leg-list">
          <h3 className={Classes.HEADING}>구간</h3>
          <ol>
            {selectedRoute.legs.map((leg, index) => (
              <li key={index}>
                <strong>구간 {index + 1}</strong>
                <span>{formatDistance(leg.distanceMeters)}</span>
                <span>{formatDuration(leg.durationSeconds)}</span>
                <span>단계 {leg.steps.length}개</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Callout compact icon="info-sign">
          Provider가 반환한 경로 구간이 없습니다.
        </Callout>
      )}
    </div>
  );
}

function RequestTabPanel({
  response,
  submittedRequest,
}: {
  response: RoutePlaygroundResponse | null;
  submittedRequest: unknown;
}) {
  if (submittedRequest === null)
    return <OutputEmpty title="전송한 요청이 없습니다" />;
  return (
    <div className="route-playground-json-grid">
      <JsonViewer title="전송한 요청" value={submittedRequest} />
      <JsonViewer
        title="정규화된 요청"
        value={response?.normalizedRequest ?? null}
      />
      <JsonViewer
        title="Provider 선택"
        value={
          response
            ? {
                selectedProvider:
                  response.selectedProvider ?? response.provider,
                reason: response.providerSelectionReason,
                capabilities: response.providerCapabilities,
                available: response.providerAvailable,
                unavailableReason: response.providerUnavailableReason,
                fallback: 'disabled',
              }
            : null
        }
      />
      <JsonViewer
        title="Provider 요청"
        value={response?.providerRequest ?? null}
      />
    </div>
  );
}

function ResponseTabPanel({
  response,
}: {
  response: RoutePlaygroundResponse | null;
}) {
  if (!response) return <OutputEmpty title="수신한 응답이 없습니다" />;
  return (
    <div className="route-playground-json-grid">
      {response.rawProviderResponse !== undefined ? (
        <JsonViewer
          title="Raw Provider Response"
          value={response.rawProviderResponse}
        />
      ) : (
        <Callout compact icon="lock">
          {response.rawProviderResponseExposed
            ? '캐시 적중 또는 adapter 제한으로 Raw Provider Response가 없습니다.'
            : 'Raw Provider Response는 현재 환경 설정에서 비활성화되어 있습니다.'}
        </Callout>
      )}
      <JsonViewer title="정규화된 경로 결과" value={response.result} />
      <JsonViewer
        title="Provider metadata"
        value={response.result.metadata ?? null}
      />
    </div>
  );
}

function DebugTabPanel({
  response,
  error,
  requestTimestamp,
}: {
  response: RoutePlaygroundResponse | null;
  error: PlaygroundError | null;
  requestTimestamp: string | null;
}) {
  const upstream = readUpstream(error?.details);
  return (
    <div className="route-playground-tab-content">
      <dl className="fact-grid route-playground-debug-facts">
        <Fact label="엔드포인트" value="POST /api/route/jobs" />
        <Fact
          label="Provider"
          value={response?.selectedProvider ?? response?.provider ?? '—'}
        />
        <Fact
          label="선택 사유"
          value={response?.providerSelectionReason ?? '—'}
        />
        <Fact label="Job ID" value={response?.jobId ?? '—'} />
        <Fact
          label="요청 시각"
          value={
            requestTimestamp
              ? new Date(requestTimestamp).toLocaleString('ko-KR')
              : '—'
          }
        />
        <Fact
          label="응답 시간"
          value={
            response?.providerLatencyMs === undefined
              ? '—'
              : `${response.providerLatencyMs} ms`
          }
        />
        <Fact
          label="Upstream 상태"
          value={
            readMetadataStatus(response?.result.metadata) ??
            upstream?.httpStatus ??
            upstream?.status ??
            '—'
          }
        />
        <Fact label="경로 수" value={response?.result.routes.length ?? '—'} />
        <Fact
          label="캐시"
          value={response?.cache ? (response.cache.hit ? 'hit' : 'miss') : '—'}
        />
      </dl>
      {response?.result.metadata !== undefined && (
        <JsonViewer
          title="Provider metadata"
          value={response.result.metadata}
        />
      )}
      {error?.details !== undefined && (
        <JsonViewer title="정규화된 Upstream 오류" value={error.details} />
      )}
    </div>
  );
}

function readWalkingDuration(route: NormalizedRoute | undefined) {
  if (!route?.providerMetadata || typeof route.providerMetadata !== 'object') {
    return null;
  }
  const value = (route.providerMetadata as Record<string, unknown>)
    .walkingDurationSeconds;
  return typeof value === 'number' ? value : null;
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ko-KR') : '—';
}

function ProviderError({ error }: { error: PlaygroundError }) {
  const upstream = readUpstream(error.details);
  return (
    <div className="route-playground-tab-content">
      <Callout intent={Intent.DANGER} title={error.code}>
        {error.message}
      </Callout>
      <dl className="fact-grid route-playground-error-facts">
        <Fact label="엔드포인트 HTTP" value={error.httpStatus ?? '—'} />
        <Fact label="오류 코드" value={error.code} />
        <Fact label="Upstream HTTP" value={upstream?.httpStatus ?? '—'} />
        <Fact label="Provider 상태" value={upstream?.status ?? '—'} />
        <Fact label="Provider 메시지" value={upstream?.message ?? '—'} />
      </dl>
      {error.details !== undefined && (
        <JsonViewer title="Upstream 상세 정보" value={error.details} />
      )}
    </div>
  );
}

function OutputEmpty({ title }: { title: string }) {
  return (
    <div className="route-playground-output-empty">
      <NonIdealState
        description="경로 실행 후 이 패널에서 결과를 확인할 수 있습니다."
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
  const direct = details as {
    upstream?: unknown;
    httpStatus?: number | null;
    status?: string | null;
    message?: string | null;
  };
  const upstream = direct.upstream;
  return typeof upstream === 'object' && upstream !== null
    ? (upstream as {
        httpStatus?: number | null;
        status?: string | null;
        message?: string | null;
      })
    : direct;
}

function readMetadataStatus(metadata: unknown): number | string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const status = (metadata as { upstreamStatus?: unknown }).upstreamStatus;
  return typeof status === 'number' || typeof status === 'string'
    ? status
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
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
}
