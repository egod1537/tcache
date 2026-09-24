import type {
  LegacyRouteLocation,
  PublicRouteLocation,
  PublicRouteRequest,
  RouteTravelMode,
} from '../../../apps/testbed/src/api/client';
import { ROUTE_MODE_LABELS } from '../route-ui-labels';

export type RouteLocationKind = LegacyRouteLocation['type'];

export interface RouteLocationDraft {
  type: RouteLocationKind;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string;
  kakaoPlaceId: string;
  navitimeId: string;
  ekispertId: string;
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
  countryCode: string;
  provider: string;
}

export interface RoutePlaygroundPreset {
  id: string;
  label: string;
  countryCode: 'JP' | 'KR';
  mode: RouteTravelMode;
  locations: Array<{ name: string; latitude: number; longitude: number }>;
}

export const ROUTE_PLAYGROUND_PRESETS: RoutePlaygroundPreset[] = [
  {
    id: 'japan-driving',
    label: 'Japan · Tokyo driving',
    countryCode: 'JP',
    mode: 'DRIVING',
    locations: [
      { name: 'Tokyo Station', latitude: 35.681236, longitude: 139.767125 },
      { name: 'Shibuya', latitude: 35.658034, longitude: 139.701636 },
    ],
  },
  {
    id: 'japan-walking',
    label: 'Japan · Tokyo walking',
    countryCode: 'JP',
    mode: 'WALKING',
    locations: [
      { name: 'Tokyo Station', latitude: 35.681236, longitude: 139.767125 },
      { name: 'Tokyo Tower', latitude: 35.658581, longitude: 139.745433 },
    ],
  },
  {
    id: 'japan-transit',
    label: 'Japan · Tokyo Station → Shibuya transit',
    countryCode: 'JP',
    mode: 'TRANSIT',
    locations: [
      { name: 'Tokyo Station', latitude: 35.681236, longitude: 139.767125 },
      { name: 'Shibuya', latitude: 35.658034, longitude: 139.701636 },
    ],
  },
  {
    id: 'japan-transit-tokyo-tower',
    label: 'Japan · Tokyo Station → Tokyo Tower transit',
    countryCode: 'JP',
    mode: 'TRANSIT',
    locations: [
      { name: 'Tokyo Station', latitude: 35.681236, longitude: 139.767125 },
      { name: 'Tokyo Tower', latitude: 35.658581, longitude: 139.745433 },
    ],
  },
  {
    id: 'japan-transit-shinjuku-asakusa',
    label: 'Japan · Shinjuku → Asakusa transit',
    countryCode: 'JP',
    mode: 'TRANSIT',
    locations: [
      { name: 'Shinjuku', latitude: 35.690921, longitude: 139.700258 },
      { name: 'Asakusa', latitude: 35.714765, longitude: 139.796655 },
    ],
  },
  {
    id: 'japan-transit-multi-stop',
    label: 'Japan · Tokyo Station → Asakusa → Shibuya transit',
    countryCode: 'JP',
    mode: 'TRANSIT',
    locations: [
      { name: 'Tokyo Station', latitude: 35.681236, longitude: 139.767125 },
      { name: 'Asakusa', latitude: 35.714765, longitude: 139.796655 },
      { name: 'Shibuya', latitude: 35.658034, longitude: 139.701636 },
    ],
  },
  {
    id: 'korea-driving',
    label: 'Korea · Seoul driving',
    countryCode: 'KR',
    mode: 'DRIVING',
    locations: [
      { name: 'Seoul Station', latitude: 37.554722, longitude: 126.970833 },
      { name: 'Gangnam Station', latitude: 37.497942, longitude: 127.027621 },
    ],
  },
  {
    id: 'korea-walking',
    label: 'Korea · Seoul walking',
    countryCode: 'KR',
    mode: 'WALKING',
    locations: [
      { name: 'Gwanghwamun', latitude: 37.571607, longitude: 126.976897 },
      { name: 'Gyeongbokgung', latitude: 37.579617, longitude: 126.977041 },
    ],
  },
  {
    id: 'korea-transit',
    label: 'Korea · Seoul transit',
    countryCode: 'KR',
    mode: 'TRANSIT',
    locations: [
      { name: 'Seoul Station', latitude: 37.554722, longitude: 126.970833 },
      { name: 'Gangnam Station', latitude: 37.497942, longitude: 127.027621 },
    ],
  },
];

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
    name: '',
    address,
    latitude: '',
    longitude: '',
    placeId: '',
    kakaoPlaceId: '',
    navitimeId: '',
    ekispertId: '',
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
  return createRoutePresetDraft(ROUTE_PLAYGROUND_PRESETS[0]!);
}

export function createRoutePresetDraft(
  preset: RoutePlaygroundPreset,
): RouteRequestDraft {
  return {
    locations: preset.locations.map((location) =>
      createRouteDraftLocation({
        type: 'coordinates',
        name: location.name,
        address: '',
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        placeId: '',
        kakaoPlaceId: '',
        navitimeId: '',
        ekispertId: '',
      }),
    ),
    travelMode: preset.mode,
    computeAlternativeRoutes: false,
    departureTime: createDefaultDepartureTime(),
    languageCode: preset.countryCode === 'JP' ? 'ja' : 'ko',
    regionCode: preset.countryCode,
    routingPreference: '',
    countryCode: preset.countryCode,
    provider: '',
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
    ...(draft.countryCode.trim()
      ? { countryCode: draft.countryCode.trim().toUpperCase() }
      : {}),
    ...(draft.provider ? { provider: draft.provider } : {}),
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
    ...(draft.countryCode.trim()
      ? { countryCode: draft.countryCode.trim().toUpperCase() }
      : {}),
    ...(draft.provider ? { provider: draft.provider } : {}),
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
  }
  if (value.type === 'placeId') {
    if (!value.placeId.trim())
      throw new Error(`${label} Place ID를 입력하세요.`);
  }
  const hasLatitude = Boolean(value.latitude.trim());
  const hasLongitude = Boolean(value.longitude.trim());
  let coordinates: { latitude: number; longitude: number } | undefined;
  if (value.type === 'coordinates' || hasLatitude || hasLongitude) {
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    if (
      !hasLatitude ||
      !hasLongitude ||
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

function toRouteLocationPreview(value: RouteLocationDraft): unknown {
  return {
    ...(value.name ? { name: value.name } : {}),
    ...(value.address ? { address: value.address } : {}),
    ...(value.latitude || value.longitude
      ? {
          coordinates: {
            latitude: numberOrOriginal(value.latitude),
            longitude: numberOrOriginal(value.longitude),
          },
        }
      : {}),
    ...(value.placeId ||
    value.kakaoPlaceId ||
    value.navitimeId ||
    value.ekispertId
      ? {
          externalIds: {
            ...(value.placeId ? { googlePlaceId: value.placeId } : {}),
            ...(value.kakaoPlaceId ? { kakaoPlaceId: value.kakaoPlaceId } : {}),
            ...(value.navitimeId ? { navitimeId: value.navitimeId } : {}),
            ...(value.ekispertId ? { ekispertId: value.ekispertId } : {}),
          },
        }
      : {}),
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
