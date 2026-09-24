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
import { useEffect, useState } from 'react';

import type {
  NormalizedRouteProviderResult,
  NormalizedRoute,
  RouteJobResult,
  RouteJobStatus,
  RouteJobStreamEventType,
  RouteJobStreamState,
  RouteJobView,
} from '../../apps/testbed/src/api/client';
import type { CheckState } from '../../apps/testbed/src/api/useTcacheStatus';
import { JsonViewer } from '../../apps/testbed/src/components/common/JsonViewer';
import { SectionHeader } from '../../apps/testbed/src/components/common/SectionHeader';
import { HealthTag } from '../../apps/testbed/src/components/status/HealthTag';
import { RouteMapPanel } from './components/RouteMapPanel';
import { routeJobStatusLabel, routeModeLabel } from './route-ui-labels';

interface RouteDetailProps {
  job: RouteJobView | null;
  result: RouteJobResult | null;
  resultLoading: boolean;
  cancelling: boolean;
  streamState: RouteJobStreamState;
  progressSource: 'sse' | 'polling' | 'none';
  latestEvent: {
    type: RouteJobStreamEventType | 'poll';
    receivedAt: string;
  } | null;
  systemState: CheckState;
  serverState: CheckState;
  service: ServiceStatus | null;
  onCancel: (jobId: string) => void;
}

function statusIntent(status: RouteJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

export function RouteDetail({
  job,
  result,
  resultLoading,
  cancelling,
  streamState,
  progressSource,
  latestEvent,
  systemState,
  serverState,
  service,
  onCancel,
}: RouteDetailProps) {
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  useEffect(() => setSelectedRouteIndex(0), [job?.jobId]);

  if (!job) {
    return (
      <Card className="route-detail-empty" compact elevation={1}>
        <NonIdealState
          description="새 요청을 만들거나 왼쪽에서 기존 작업을 선택하세요."
          icon="search"
          title="경로 작업을 선택하세요"
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
  const providerResult = parseRouteProviderResult(result?.result);
  const selectedRoute = providerResult?.routes[selectedRouteIndex];

  return (
    <div className="route-job-detail">
      <div className="panel-heading detail-heading">
        <div>
          <h1 className={Classes.HEADING}>경로 작업 상세</h1>
          <code className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}>
            {job.jobId}
          </code>
        </div>
        <div className="detail-actions">
          <Tag intent={statusIntent(job.status)}>
            {routeJobStatusLabel(job.status)}
          </Tag>
          {cancellable && (
            <Button
              icon="stop"
              intent={Intent.WARNING}
              loading={cancelling}
              onClick={() => onCancel(job.jobId)}
              size="small"
            >
              작업 취소
            </Button>
          )}
        </div>
      </div>
      <Divider />

      <div className="detail-content">
        {streamState === 'reconnecting' && cancellable && (
          <Callout compact intent={Intent.WARNING} title="SSE 재연결 중">
            SSE가 다시 연결될 때까지 Polling으로 작업 상태를 갱신합니다.
          </Callout>
        )}

        {job.error && (
          <Card className="detail-section" compact>
            <Callout intent={Intent.DANGER} title={job.error.code}>
              {job.error.message}
            </Callout>
            {job.error.details !== undefined && (
              <JsonViewer
                title="Upstream 오류 상세"
                value={job.error.details}
              />
            )}
          </Card>
        )}

        <Card className="detail-section" compact>
          <SectionHeader title="개요" description={job.message} />
          <dl className="fact-grid route-overview-facts">
            <Fact label="작업 ID" value={job.jobId} />
            <Fact label="상태" value={routeJobStatusLabel(job.status)} />
            <Fact label="단계" value={job.stage} />
            <Fact label="진행률" value={`${job.progress}%`} />
            <Fact
              label="생성 시각"
              value={new Date(job.createdAt).toLocaleString('ko-KR')}
            />
            <Fact
              label="수정 시각"
              value={new Date(job.updatedAt).toLocaleString('ko-KR')}
            />
            <Fact
              label="완료 시각"
              value={
                job.completedAt
                  ? new Date(job.completedAt).toLocaleString('ko-KR')
                  : '—'
              }
            />
            <Fact
              label="선택 Provider"
              value={providerDisplayName(job.selectedProvider ?? job.provider)}
            />
            <Fact
              label="선택 사유"
              value={job.providerSelectionReason ?? '—'}
            />
            <Fact
              label="선택 출처"
              value={job.providerSelectionSource ?? '—'}
            />
            <Fact label="국가" value={job.countryCode ?? '기본 정책'} />
            <Fact
              label="이동 수단"
              value={routeModeLabel(job.mode ?? job.request.travelMode)}
            />
            <Fact label="응답 Provider" value={job.provider ?? '—'} />
          </dl>
        </Card>

        <Card className="detail-section" compact>
          <SectionHeader title="진행 상황" description={job.message} />
          <ProgressBar
            animate={cancellable}
            intent={statusIntent(job.status)}
            stripes={cancellable}
            value={job.progress / 100}
          />
          <dl className="fact-grid route-progress-facts">
            <div>
              <dt>단계</dt>
              <dd>
                <Tag icon="timeline-events" minimal>
                  {job.stage}
                </Tag>
              </dd>
            </div>
            <Fact label="진행률" value={`${job.progress}%`} />
            <div>
              <dt>경로 모듈</dt>
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
            title="SSE"
            description="실시간 작업 전송 및 대체 연결 상태"
          />
          <dl className="fact-grid route-sse-facts">
            <div>
              <dt>연결</dt>
              <dd>
                <Tag intent={streamIntent(streamState)}>
                  {streamLabel(streamState)}
                </Tag>
              </dd>
            </div>
            <Fact
              label="진행 정보 출처"
              value={
                progressSource === 'sse'
                  ? 'SSE'
                  : progressSource === 'polling'
                    ? 'Polling 대체 연결'
                    : '—'
              }
            />
            <Fact label="최근 이벤트" value={latestEvent?.type ?? '—'} />
            <Fact
              label="수신 시각"
              value={
                latestEvent
                  ? new Date(latestEvent.receivedAt).toLocaleTimeString('ko-KR')
                  : '—'
              }
            />
          </dl>
        </Card>

        <Card className="detail-section" compact>
          <SectionHeader
            title="요청"
            description="전송한 입력과 서버 정규화 결과"
          />
          <dl className="fact-grid route-request-facts">
            <Fact
              label="출발지"
              value={
                job.requestMetadata?.fromKey ??
                formatLocation(
                  job.normalizedRequest?.origin ?? job.request.origin,
                )
              }
            />
            <Fact
              label="도착지"
              value={
                job.requestMetadata?.toKey ??
                formatLocation(
                  job.normalizedRequest?.destination ?? job.request.destination,
                )
              }
            />
            <Fact
              label="경유지"
              value={
                job.requestMetadata?.intermediateKeys.length ??
                job.normalizedRequest?.intermediates.length ??
                job.request.intermediates?.length ??
                0
              }
            />
            <Fact
              label="이동 수단"
              value={routeModeLabel(job.request.travelMode)}
            />
            <Fact
              label="요일 유형"
              value={job.requestMetadata?.dayType ?? '—'}
            />
            <Fact
              label="시간 버킷"
              value={job.requestMetadata?.timeBucket ?? '—'}
            />
            <Fact
              label="Timezone"
              value={job.requestMetadata?.timeZone ?? '—'}
            />
          </dl>
          <div className="route-transformation-flow">
            <TransformationStep
              label="Client Request"
              value={job.clientRequest ?? job.request}
            />
            <TransformationArrow />
            <TransformationStep
              label="Normalized Route Request"
              value={job.normalizedRequest ?? job.request}
            />
            <TransformationArrow />
            <TransformationStep
              label="Canonical Locations"
              value={{
                origin: job.requestMetadata?.fromKey,
                intermediates: job.requestMetadata?.intermediateKeys ?? [],
                destination: job.requestMetadata?.toKey,
              }}
            />
            <TransformationArrow />
            <TransformationStep
              label="Provider Selection"
              value={{
                provider: job.selectedProvider,
                reason: job.providerSelectionReason,
                capabilities: job.providerCapabilities,
                available: job.providerAvailable,
                unavailableReason: job.providerUnavailableReason,
                fallback: job.fallbackPolicy ?? 'disabled',
              }}
            />
            <TransformationArrow />
            <TransformationStep
              label="Provider Request"
              value={job.providerRequest ?? null}
            />
          </div>
        </Card>

        <div className="detail-section-grid">
          <Card className="detail-section" compact>
            <SectionHeader title="캐시" description="조회 결과와 정책" />
            {job.cache ? (
              <dl className="compact-facts">
                <div>
                  <dt>결과</dt>
                  <dd>
                    <Tag
                      intent={job.cache.hit ? Intent.SUCCESS : Intent.WARNING}
                    >
                      {job.cache.hit ? '적중' : '미적중'}
                    </Tag>
                  </dd>
                </div>
                <Fact label="TTL" value={`${job.cache.ttl}s`} />
                <Fact label="Namespace" value={cacheNamespace(job.cache.key)} />
                <Fact
                  label="Provider"
                  value={providerDisplayName(
                    job.selectedProvider ?? job.provider,
                  )}
                />
                <Fact
                  label="시간 버킷"
                  value={job.requestMetadata?.timeBucket ?? '—'}
                />
                <Fact
                  label="Timezone"
                  value={job.requestMetadata?.timeZone ?? '—'}
                />
                <Fact
                  label="요일 유형"
                  value={job.requestMetadata?.dayType ?? '—'}
                />
                <details className="route-cache-key-debug">
                  <summary>전체 cache key</summary>
                  <code className={Classes.MONOSPACE_TEXT}>
                    {job.cache.key}
                  </code>
                </details>
              </dl>
            ) : (
              <Callout compact icon="time">
                캐시 조회가 아직 완료되지 않았습니다.
              </Callout>
            )}
          </Card>

          <Card className="detail-section" compact>
            <SectionHeader
              title="Provider Selection"
              description="선택 정책과 adapter capability"
            />
            <dl className="compact-facts">
              <Fact
                label="Selected Provider"
                value={providerDisplayName(
                  job.selectedProvider ?? job.provider,
                )}
              />
              <Fact label="Reason" value={job.providerSelectionReason ?? '—'} />
              <Fact label="Source" value={job.providerSelectionSource ?? '—'} />
              <Fact
                label="Modes"
                value={job.providerCapabilities?.modes.join(', ') ?? '—'}
              />
              <Fact
                label="Availability"
                value={
                  job.providerAvailable === undefined
                    ? '—'
                    : job.providerAvailable
                      ? 'available'
                      : `unavailable${job.providerUnavailableReason ? ` · ${job.providerUnavailableReason}` : ''}`
                }
              />
              <Fact
                label="Waypoints"
                value={
                  job.providerCapabilities
                    ? job.providerCapabilities.supportsWaypoints
                      ? 'supported'
                      : 'unsupported'
                    : '—'
                }
              />
              <Fact
                label="Max locations"
                value={job.providerCapabilities?.maxLocations ?? '—'}
              />
              <Fact label="Fallback" value={job.fallbackPolicy ?? 'disabled'} />
              <Fact
                label="응답 시간"
                value={
                  job.providerLatencyMs === undefined
                    ? '—'
                    : `${job.providerLatencyMs}ms`
                }
              />
            </dl>
          </Card>
        </div>

        <Card className="detail-section" compact>
          <SectionHeader
            title="경로 결과"
            description="정규화된 Provider 경로"
          />
          {resultLoading ? (
            <Callout compact icon="time">
              최종 결과를 불러오는 중…
            </Callout>
          ) : providerResult && providerResult.routes.length ? (
            <>
              <div className="route-result-selector" aria-label="경로 선택">
                {providerResult.routes.map((route, index) => (
                  <button
                    aria-pressed={selectedRouteIndex === index}
                    className="route-result-option"
                    key={`${index}-${route.encodedPolyline.slice(0, 16)}`}
                    onClick={() => setSelectedRouteIndex(index)}
                    type="button"
                  >
                    <strong>경로 {index + 1}</strong>
                    <span>{formatDuration(route.durationSeconds)}</span>
                    <small>{formatDistance(route.distanceMeters)}</small>
                  </button>
                ))}
              </div>
              {selectedRoute && <RouteSummary route={selectedRoute} />}
            </>
          ) : result?.result !== undefined ? (
            <Callout compact icon="info-sign">
              Provider 결과에 정규화된 경로가 없습니다. 원본 JSON을 확인하세요.
            </Callout>
          ) : (
            <Callout compact icon="info-sign">
              작업이 완료되면 최종 결과를 확인할 수 있습니다.
            </Callout>
          )}
        </Card>

        {selectedRoute && (
          <Card className="detail-section" compact>
            <SectionHeader
              title="지도"
              description={`경로 ${selectedRouteIndex + 1}의 polyline과 위치`}
            />
            <RouteMapPanel route={selectedRoute} />
          </Card>
        )}

        <Card className="detail-section route-debug-section" compact>
          <SectionHeader
            title="디버그"
            description="정규화된 결과와 Provider 원본 진단 정보(API 키 제외)"
          />
          {providerResult && (
            <>
              {job.rawProviderResponse !== undefined && (
                <details>
                  <summary>Raw Provider Response</summary>
                  <JsonViewer
                    title="Raw Provider Response"
                    value={job.rawProviderResponse}
                  />
                </details>
              )}
              {job.rawProviderResponse === undefined && (
                <Callout compact icon="lock">
                  {job.rawProviderResponseExposed
                    ? '캐시 적중 또는 adapter 제한으로 Raw Provider Response가 없습니다.'
                    : 'Raw Provider Response는 현재 환경 설정에서 비활성화되어 있습니다.'}
                </Callout>
              )}
              <TransformationArrow />
              <details>
                <summary>Normalized Route Result</summary>
                <JsonViewer
                  title="Normalized Route Result"
                  value={providerResult}
                />
              </details>
              {providerResult.metadata !== undefined && (
                <details>
                  <summary>Provider 메타데이터</summary>
                  <JsonViewer
                    title="Provider 메타데이터"
                    value={providerResult.metadata}
                  />
                </details>
              )}
            </>
          )}
          {result?.result !== undefined && !providerResult && (
            <JsonViewer title="원본 JSON" value={result.result} />
          )}
        </Card>
      </div>
    </div>
  );
}

function TransformationStep({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <details className="route-request-json">
      <summary>{label}</summary>
      <JsonViewer title={label} value={value} />
    </details>
  );
}

function TransformationArrow() {
  return <div className="route-transformation-arrow">↓</div>;
}

function cacheNamespace(key: string) {
  return key.split(':').slice(0, 2).join(':') || '—';
}

function streamIntent(state: RouteJobStreamState) {
  if (state === 'connected') return Intent.SUCCESS;
  if (state === 'reconnecting') return Intent.WARNING;
  return Intent.NONE;
}

function streamLabel(state: RouteJobStreamState) {
  if (state === 'connected') return '연결됨';
  if (state === 'reconnecting') return '재연결 중';
  return '연결 끊김';
}

function formatLocation(value: unknown) {
  if (typeof value !== 'object' || value === null) return '—';
  const location = value as Record<string, unknown>;
  if (typeof location.placeId === 'string') return `place:${location.placeId}`;
  if (typeof location.address === 'string') return location.address;
  const externalIds =
    typeof location.externalIds === 'object' && location.externalIds !== null
      ? (location.externalIds as Record<string, unknown>)
      : {};
  if (typeof externalIds.googlePlaceId === 'string') {
    return `google:${externalIds.googlePlaceId}`;
  }
  if (typeof externalIds.ekispertId === 'string') {
    return `ekispert:${externalIds.ekispertId}`;
  }
  const coordinates =
    typeof location.coordinates === 'object' && location.coordinates !== null
      ? (location.coordinates as Record<string, unknown>)
      : location;
  const latitude = coordinates.latitude ?? coordinates.lat;
  const longitude = coordinates.longitude ?? coordinates.lng;
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? `${latitude}, ${longitude}`
    : '—';
}

function providerDisplayName(value: string | undefined) {
  if (!value) return '—';
  if (value === 'ekispert') return 'Ekispert';
  if (value === 'navitime') return 'NAVITIME';
  if (value === 'otp') return 'OpenTripPlanner (experimental)';
  if (value === 'google') return 'Google';
  if (value === 'kakao-mobility') return 'Kakao Mobility';
  if (value === 'kakao-maps') return 'Kakao Maps';
  return value;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RouteSummary({ route }: { route: NormalizedRoute }) {
  return (
    <div className="route-result-summary">
      <dl className="fact-grid">
        <Fact label="거리" value={formatDistance(route.distanceMeters)} />
        <Fact label="소요 시간" value={formatDuration(route.durationSeconds)} />
        <Fact label="경로 점" value={route.path.length} />
        <Fact label="구간" value={route.legs.length} />
      </dl>
      {route.description && <p>{route.description}</p>}
      {route.legs.length > 0 && (
        <details className="route-leg-details">
          <summary>구간 상세 ({route.legs.length})</summary>
          <ol>
            {route.legs.map((leg, index) => (
              <li key={index}>
                <strong>구간 {index + 1}</strong> ·{' '}
                {formatDistance(leg.distanceMeters)} ·{' '}
                {formatDuration(leg.durationSeconds)} · 단계 {leg.steps.length}
                개
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function parseRouteProviderResult(
  value: unknown,
): NormalizedRouteProviderResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Partial<NormalizedRouteProviderResult>;
  return typeof result.provider === 'string' && Array.isArray(result.routes)
    ? (result as NormalizedRouteProviderResult)
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
