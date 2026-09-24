import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  Switch,
} from '@blueprintjs/core';
import { useMemo, useState } from 'react';

import type {
  LegacyRouteLocation,
  PublicRouteLocation,
  PublicRouteRequest,
  RouteTravelMode,
} from '../../../apps/testbed/src/api/client';
import { ROUTE_MODE_LABELS } from '../route-ui-labels';

type LocationKind = LegacyRouteLocation['type'];

interface LocationDraft {
  type: LocationKind;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string;
  kakaoPlaceId: string;
  navitimeId: string;
  ekispertId: string;
}

const newLocation = (address = ''): LocationDraft => ({
  type: 'address',
  name: '',
  address,
  latitude: '',
  longitude: '',
  placeId: '',
  kakaoPlaceId: '',
  navitimeId: '',
  ekispertId: '',
});

const modeOptions: Array<{ value: RouteTravelMode; label: string }> = [
  { value: 'DRIVING', label: ROUTE_MODE_LABELS.DRIVING },
  { value: 'WALKING', label: ROUTE_MODE_LABELS.WALKING },
  { value: 'BICYCLING', label: ROUTE_MODE_LABELS.BICYCLING },
  { value: 'TRANSIT', label: ROUTE_MODE_LABELS.TRANSIT },
];

interface NewRouteJobDialogProps {
  dark: boolean;
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (request: unknown) => Promise<void>;
  title?: string;
  description?: string;
  submitLabel?: string;
}

export function NewRouteJobDialog({
  dark,
  isOpen,
  creating,
  onClose,
  onCreate,
  title = '새 경로 작업',
  description = '백엔드에서 이 요청을 작업, SSE, 캐시 파이프라인으로 처리합니다.',
  submitLabel = '작업 생성',
}: NewRouteJobDialogProps) {
  const [origin, setOrigin] = useState(() => newLocation('東京駅、日本'));
  const [destination, setDestination] = useState(() =>
    newLocation('東京タワー、日本'),
  );
  const [intermediates, setIntermediates] = useState<LocationDraft[]>([]);
  const [travelMode, setTravelMode] = useState<RouteTravelMode>('DRIVING');
  const [alternatives, setAlternatives] = useState(false);
  const [languageCode, setLanguageCode] = useState('ja');
  const [regionCode, setRegionCode] = useState('JP');
  const [countryCode, setCountryCode] = useState('JP');
  const [provider, setProvider] = useState('');
  const [departureTime, setDepartureTime] = useState(
    createDefaultDepartureTime,
  );
  const [routingPreference, setRoutingPreference] = useState('');
  const [rawOverride, setRawOverride] = useState<string | null>(null);
  const [error, setError] = useState('');

  const generatedRequest = useMemo(() => {
    try {
      return buildRequest({
        origin,
        destination,
        intermediates,
        travelMode,
        alternatives,
        languageCode,
        regionCode,
        countryCode,
        provider,
        departureTime,
        routingPreference,
      });
    } catch {
      return null;
    }
  }, [
    origin,
    destination,
    intermediates,
    travelMode,
    alternatives,
    languageCode,
    regionCode,
    countryCode,
    provider,
    departureTime,
    routingPreference,
  ]);
  const generatedJson = JSON.stringify(generatedRequest ?? {}, null, 2);

  function updateIntermediate(index: number, value: LocationDraft) {
    setRawOverride(null);
    setIntermediates((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  async function submit() {
    let request: unknown;
    try {
      request =
        rawOverride === null ? generatedRequest : JSON.parse(rawOverride);
      if (!request) {
        throw new Error('출발지, 도착지와 좌표 값을 모두 입력하세요.');
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : '요청 JSON 형식이 올바르지 않습니다.',
      );
      return;
    }

    setError('');
    try {
      await onCreate(request);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : '경로 요청을 전송하지 못했습니다.',
      );
    }
  }

  return (
    <Dialog
      canEscapeKeyClose={!creating}
      className="new-route-job-dialog"
      icon="route"
      isCloseButtonShown={!creating}
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      {...(dark ? { portalClassName: Classes.DARK } : {})}
    >
      <DialogBody>
        <p className={Classes.TEXT_MUTED}>{description}</p>

        <LocationEditor
          label="출발지"
          onChange={(value) => {
            setRawOverride(null);
            setOrigin(value);
          }}
          value={origin}
        />

        <div className="route-waypoint-heading">
          <strong>경유지</strong>
          <Button
            disabled={intermediates.length >= 25}
            icon="plus"
            onClick={() => {
              setRawOverride(null);
              setIntermediates((current) => [...current, newLocation()]);
            }}
            size="small"
            variant="minimal"
          >
            추가
          </Button>
        </div>
        {intermediates.length === 0 && (
          <p className={`${Classes.TEXT_MUTED} route-waypoint-empty`}>
            경유지가 없습니다.
          </p>
        )}
        {intermediates.map((intermediate, index) => (
          <div className="route-waypoint-row" key={index}>
            <LocationEditor
              compact
              label={`경유지 ${index + 1}`}
              onChange={(value) => updateIntermediate(index, value)}
              value={intermediate}
            />
            <Button
              aria-label={`경유지 ${index + 1} 삭제`}
              icon="trash"
              intent={Intent.DANGER}
              onClick={() => {
                setRawOverride(null);
                setIntermediates((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
              size="small"
              variant="minimal"
            />
          </div>
        ))}

        <LocationEditor
          label="도착지"
          onChange={(value) => {
            setRawOverride(null);
            setDestination(value);
          }}
          value={destination}
        />

        <div className="route-job-options">
          <FormGroup label="이동 수단" labelFor="route-travel-mode">
            <HTMLSelect
              fill
              id="route-travel-mode"
              onChange={(event) => {
                setRawOverride(null);
                const nextMode = event.target.value as RouteTravelMode;
                setTravelMode(nextMode);
                if (nextMode !== 'DRIVING') setRoutingPreference('');
              }}
              options={modeOptions}
              value={travelMode}
            />
          </FormGroup>
          <Switch
            checked={alternatives}
            label="대체 경로"
            onChange={(event) => {
              setRawOverride(null);
              setAlternatives(event.currentTarget.checked);
            }}
          />
        </div>

        <details className="route-advanced-options">
          <summary>고급 옵션 및 원본 JSON</summary>
          <div className="route-advanced-grid">
            <FormGroup label="언어 코드" labelFor="route-language">
              <InputGroup
                id="route-language"
                onChange={(event) => {
                  setRawOverride(null);
                  setLanguageCode(event.target.value);
                }}
                value={languageCode}
              />
            </FormGroup>
            <FormGroup label="지역 코드" labelFor="route-region">
              <InputGroup
                id="route-region"
                onChange={(event) => {
                  setRawOverride(null);
                  setRegionCode(event.target.value);
                }}
                value={regionCode}
              />
            </FormGroup>
            <FormGroup label="국가 코드" labelFor="route-country">
              <InputGroup
                id="route-country"
                maxLength={2}
                onChange={(event) => {
                  setRawOverride(null);
                  setCountryCode(event.target.value.toUpperCase());
                }}
                placeholder="JP"
                value={countryCode}
              />
            </FormGroup>
            <FormGroup label="Provider override" labelFor="route-provider">
              <HTMLSelect
                fill
                id="route-provider"
                onChange={(event) => {
                  setRawOverride(null);
                  setProvider(event.target.value);
                }}
                options={[
                  { value: '', label: '자동 선택' },
                  { value: 'google', label: 'Google' },
                  { value: 'kakao-mobility', label: 'Kakao Mobility' },
                  { value: 'kakao-maps', label: 'Kakao Maps' },
                  { value: 'ekispert', label: 'Ekispert' },
                  { value: 'navitime', label: 'NAVITIME' },
                  { value: 'otp', label: 'OpenTripPlanner (experimental)' },
                  { value: 'mock', label: 'Mock' },
                ]}
                value={provider}
              />
            </FormGroup>
            <FormGroup label="출발 시각" labelFor="route-departure">
              <InputGroup
                id="route-departure"
                onChange={(event) => {
                  setRawOverride(null);
                  setDepartureTime(event.target.value);
                }}
                type="datetime-local"
                value={departureTime}
              />
            </FormGroup>
            <FormGroup
              label="경로 탐색 옵션"
              labelFor="route-routing-preference"
            >
              <HTMLSelect
                disabled={travelMode !== 'DRIVING'}
                fill
                id="route-routing-preference"
                onChange={(event) => {
                  setRawOverride(null);
                  setRoutingPreference(event.target.value);
                }}
                options={[
                  { value: '', label: 'Google 기본값' },
                  { value: 'TRAFFIC_AWARE', label: '교통 상황 반영' },
                  {
                    value: 'TRAFFIC_AWARE_OPTIMAL',
                    label: '교통 상황 최적 반영',
                  },
                  { value: 'TRAFFIC_UNAWARE', label: '교통 상황 미반영' },
                ]}
                value={routingPreference}
              />
            </FormGroup>
          </div>
          <div className="route-raw-editor-heading">
            <span>요청 JSON</span>
            {rawOverride !== null && (
              <Button
                onClick={() => setRawOverride(null)}
                size="small"
                variant="minimal"
              >
                폼 내용으로 되돌리기
              </Button>
            )}
          </div>
          <textarea
            aria-label="경로 요청 JSON"
            className={`${Classes.INPUT} route-request-editor`}
            onChange={(event) => setRawOverride(event.target.value)}
            spellCheck={false}
            value={rawOverride ?? generatedJson}
          />
        </details>

        {error && (
          <Callout compact intent={Intent.DANGER} role="alert">
            {error}
          </Callout>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button disabled={creating} onClick={onClose}>
              취소
            </Button>
            <Button
              icon="play"
              intent={Intent.PRIMARY}
              loading={creating}
              onClick={() => void submit()}
            >
              {submitLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

function LocationEditor({
  label,
  value,
  compact = false,
  onChange,
}: {
  label: string;
  value: LocationDraft;
  compact?: boolean;
  onChange: (value: LocationDraft) => void;
}) {
  return (
    <FormGroup
      className={compact ? 'route-location-compact' : ''}
      label={label}
    >
      <div className="route-location-editor">
        <HTMLSelect
          aria-label={`${label} 유형`}
          onChange={(event) =>
            onChange({ ...value, type: event.target.value as LocationKind })
          }
          options={[
            { value: 'address', label: '주소' },
            { value: 'coordinates', label: '좌표' },
            { value: 'placeId', label: 'Place ID' },
          ]}
          value={value.type}
        />
        <InputGroup
          aria-label={`${label} 이름`}
          fill
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="장소 이름 (선택)"
          value={value.name}
        />
        <details className="route-location-debug-fields" open>
          <summary>위치 상세 / Provider ID</summary>
          <div className="route-location-debug-grid">
            <InputGroup
              aria-label={`${label} 주소`}
              fill
              onChange={(event) =>
                onChange({ ...value, address: event.target.value })
              }
              placeholder="주소"
              value={value.address}
            />
            <div className="route-coordinate-inputs">
              <InputGroup
                aria-label={`${label} 위도`}
                fill
                inputMode="decimal"
                onChange={(event) =>
                  onChange({ ...value, latitude: event.target.value })
                }
                placeholder="위도"
                value={value.latitude}
              />
              <InputGroup
                aria-label={`${label} 경도`}
                fill
                inputMode="decimal"
                onChange={(event) =>
                  onChange({ ...value, longitude: event.target.value })
                }
                placeholder="경도"
                value={value.longitude}
              />
            </div>
            <InputGroup
              aria-label={`${label} Google Place ID`}
              fill
              onChange={(event) =>
                onChange({ ...value, placeId: event.target.value })
              }
              placeholder="Google Place ID (선택)"
              value={value.placeId}
            />
            <InputGroup
              aria-label={`${label} Kakao Place ID`}
              fill
              onChange={(event) =>
                onChange({ ...value, kakaoPlaceId: event.target.value })
              }
              placeholder="Kakao Place ID (선택)"
              value={value.kakaoPlaceId}
            />
            <InputGroup
              aria-label={`${label} NAVITIME ID`}
              fill
              onChange={(event) =>
                onChange({ ...value, navitimeId: event.target.value })
              }
              placeholder="NAVITIME node/station ID (선택)"
              value={value.navitimeId}
            />
            <InputGroup
              aria-label={`${label} Ekispert ID`}
              fill
              onChange={(event) =>
                onChange({ ...value, ekispertId: event.target.value })
              }
              placeholder="Ekispert station ID (선택)"
              value={value.ekispertId}
            />
          </div>
        </details>
      </div>
    </FormGroup>
  );
}

function toLocation(value: LocationDraft, label: string): PublicRouteLocation {
  if (value.type === 'address') {
    if (!value.address.trim()) throw new Error(`${label} 주소를 입력하세요.`);
  }
  if (value.type === 'placeId') {
    if (!value.placeId.trim())
      throw new Error(`${label} Place ID를 입력하세요.`);
  }
  const hasLatitude = Boolean(value.latitude.trim());
  const hasLongitude = Boolean(value.longitude.trim());
  let coordinates: { latitude: number; longitude: number } | undefined;
  if (value.type === 'coordinates' || hasLatitude || hasLongitude) {
    if (!hasLatitude || !hasLongitude) {
      throw new Error(`${label} 좌표를 입력하세요.`);
    }
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error(`${label} 좌표가 올바르지 않습니다.`);
    }
    coordinates = { latitude, longitude };
  }
  const externalIds = {
    ...(value.placeId.trim() ? { googlePlaceId: value.placeId.trim() } : {}),
    ...(value.kakaoPlaceId.trim()
      ? { kakaoPlaceId: value.kakaoPlaceId.trim() }
      : {}),
    ...(value.navitimeId.trim() ? { navitimeId: value.navitimeId.trim() } : {}),
    ...(value.ekispertId.trim() ? { ekispertId: value.ekispertId.trim() } : {}),
  };
  return {
    ...(coordinates ? { coordinates } : {}),
    ...(value.name.trim() ? { name: value.name.trim() } : {}),
    ...(value.address.trim() ? { address: value.address.trim() } : {}),
    ...(Object.keys(externalIds).length ? { externalIds } : {}),
  };
}

function buildRequest(input: {
  origin: LocationDraft;
  destination: LocationDraft;
  intermediates: LocationDraft[];
  travelMode: RouteTravelMode;
  alternatives: boolean;
  languageCode: string;
  regionCode: string;
  countryCode: string;
  provider: string;
  departureTime: string;
  routingPreference: string;
}): PublicRouteRequest {
  if (!input.departureTime) throw new Error('출발 시각을 입력하세요.');
  return {
    locations: [
      toLocation(input.origin, '출발지'),
      ...input.intermediates.map((location, index) =>
        toLocation(location, `경유지 ${index + 1}`),
      ),
      toLocation(input.destination, '도착지'),
    ],
    mode: input.travelMode,
    departureTime: new Date(input.departureTime).toISOString(),
    ...(input.countryCode.trim()
      ? { countryCode: input.countryCode.trim().toUpperCase() }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.alternatives ? { computeAlternativeRoutes: true } : {}),
    ...(input.languageCode.trim()
      ? { languageCode: input.languageCode.trim() }
      : {}),
    ...(input.regionCode.trim() ? { regionCode: input.regionCode.trim() } : {}),
    ...(input.routingPreference
      ? { routingPreference: input.routingPreference }
      : {}),
  };
}

function createDefaultDepartureTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
