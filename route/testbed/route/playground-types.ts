import type {
  PublicRouteLocation,
  PublicRouteRequest,
  RouteLocation,
  RouteTravelMode,
} from '../../../apps/testbed/src/api/client';
import { ROUTE_MODE_LABELS } from '../route-ui-labels';

export type RouteLocationKind = RouteLocation['type'];

export interface RouteLocationDraft {
  type: RouteLocationKind;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string;
}

export interface RouteDraftLocation {
  id: string;
  location: RouteLocationDraft;
}

export interface RouteRequestDraft {
  locations: RouteDraftLocation[];
  travelMode: RouteTravelMode;
  computeAlternativeRoutes: boolean;
  departureTime: string;
  languageCode: string;
  regionCode: string;
  routingPreference: string;
}

export interface PlaygroundError {
  httpStatus: number | null;
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationState {
  state: 'idle' | 'valid' | 'invalid';
  message: string;
}

export const ROUTE_MODES: Array<{
  value: RouteTravelMode;
  label: string;
}> = [
  { value: 'DRIVING', label: ROUTE_MODE_LABELS.DRIVING },
  { value: 'WALKING', label: ROUTE_MODE_LABELS.WALKING },
  { value: 'BICYCLING', label: ROUTE_MODE_LABELS.BICYCLING },
  { value: 'TRANSIT', label: ROUTE_MODE_LABELS.TRANSIT },
];

export function createLocationDraft(address = ''): RouteLocationDraft {
  return {
    type: 'address',
    address,
    latitude: '',
    longitude: '',
    placeId: '',
  };
}

let locationSequence = 0;

export function createRouteDraftLocation(
  location: RouteLocationDraft = createLocationDraft(),
  id = createRouteLocationId(),
): RouteDraftLocation {
  return { id, location };
}

export function createRouteLocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  locationSequence += 1;
  return `route-location-${locationSequence}`;
}

export function createDefaultRouteDraft(): RouteRequestDraft {
  return {
    locations: [
      createRouteDraftLocation(createLocationDraft('東京駅、日本')),
      createRouteDraftLocation(createLocationDraft('東京タワー、日本')),
    ],
    travelMode: 'DRIVING',
    computeAlternativeRoutes: false,
    departureTime: createDefaultDepartureTime(),
    languageCode: 'ja',
    regionCode: 'JP',
    routingPreference: '',
  };
}

export function buildRouteRequest(
  draft: RouteRequestDraft,
): PublicRouteRequest {
  if (draft.locations.length < 2) {
    throw new Error('출발지와 도착지를 포함해 위치를 2개 이상 입력하세요.');
  }
  if (draft.locations.length > 27) {
    throw new Error('경유지는 최대 25개까지 추가할 수 있습니다.');
  }

  if (!draft.departureTime) throw new Error('출발 시각을 입력하세요.');
  const locations = draft.locations.map((item, index) =>
    toPublicRouteLocation(
      item.location,
      getLocationLabel(index, draft.locations.length),
    ),
  );

  return {
    locations,
    mode: draft.travelMode,
    departureTime: new Date(draft.departureTime).toISOString(),
    ...(draft.computeAlternativeRoutes
      ? { computeAlternativeRoutes: true }
      : {}),
    ...(draft.languageCode.trim()
      ? { languageCode: draft.languageCode.trim() }
      : {}),
    ...(draft.regionCode.trim() ? { regionCode: draft.regionCode.trim() } : {}),
    ...(draft.routingPreference
      ? { routingPreference: draft.routingPreference }
      : {}),
  };
}

export function buildRouteRequestPreview(draft: RouteRequestDraft): unknown {
  const locations = draft.locations.map((item) =>
    toRouteLocationPreview(item.location),
  );
  return {
    locations,
    mode: draft.travelMode,
    departureTime: draft.departureTime
      ? new Date(draft.departureTime).toISOString()
      : '',
    ...(draft.computeAlternativeRoutes
      ? { computeAlternativeRoutes: true }
      : {}),
    ...(draft.languageCode.trim()
      ? { languageCode: draft.languageCode.trim() }
      : {}),
    ...(draft.regionCode.trim() ? { regionCode: draft.regionCode.trim() } : {}),
    ...(draft.routingPreference
      ? { routingPreference: draft.routingPreference }
      : {}),
  };
}

export function parseRawRouteRequest(value: string): unknown {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('요청 JSON은 객체 형식이어야 합니다.');
  }
  const input = parsed as Record<string, unknown>;
  if ('locations' in input) {
    if (!Array.isArray(input.locations) || input.locations.length < 2) {
      throw new Error('위치를 2개 이상 입력하세요.');
    }
    if (input.locations.length > 27) {
      throw new Error('경유지는 최대 25개까지 추가할 수 있습니다.');
    }
    if (
      typeof input.departureTime !== 'string' ||
      Number.isNaN(Date.parse(input.departureTime)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.departureTime)
    ) {
      throw new Error('출발 시각에 timezone을 포함해 입력하세요.');
    }
  } else {
    if (!input.origin) throw new Error('출발지를 입력하세요.');
    if (!input.destination) throw new Error('도착지를 입력하세요.');
  }
  const travelMode = input.mode ?? input.travelMode;
  if (
    typeof travelMode !== 'string' ||
    !ROUTE_MODES.some((mode) => mode.value === travelMode.toUpperCase())
  ) {
    throw new Error('원본 요청의 mode 값이 올바르지 않습니다.');
  }
  return parsed;
}

function toPublicRouteLocation(
  value: RouteLocationDraft,
  label: string,
): PublicRouteLocation {
  if (value.type === 'address') {
    if (!value.address.trim()) throw new Error(`${label} 주소를 입력하세요.`);
    return { address: value.address.trim() };
  }
  if (value.type === 'placeId') {
    if (!value.placeId.trim())
      throw new Error(`${label} Place ID를 입력하세요.`);
    return { placeId: value.placeId.trim() };
  }

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (
    !value.latitude.trim() ||
    !value.longitude.trim() ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(`${label} 좌표가 올바르지 않습니다.`);
  }
  return { latitude, longitude };
}

function toRouteLocationPreview(value: RouteLocationDraft): unknown {
  if (value.type === 'address') {
    return { address: value.address };
  }
  if (value.type === 'placeId') {
    return { placeId: value.placeId };
  }
  return {
    latitude: numberOrOriginal(value.latitude),
    longitude: numberOrOriginal(value.longitude),
  };
}

function getLocationLabel(index: number, length: number) {
  if (index === 0) return '출발지';
  if (index === length - 1) return '도착지';
  return `경유지 ${index}`;
}

function createDefaultDepartureTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function numberOrOriginal(value: string): number | string {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : value;
}
