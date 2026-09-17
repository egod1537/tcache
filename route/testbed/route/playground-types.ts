import type {
  RouteLocation,
  RouteRequest,
  RouteTravelMode,
} from '../../../apps/testbed/src/api/client';

export type RouteLocationKind = RouteLocation['type'];

export interface RouteLocationDraft {
  type: RouteLocationKind;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string;
}

export interface RouteRequestDraft {
  origin: RouteLocationDraft;
  intermediates: RouteLocationDraft[];
  destination: RouteLocationDraft;
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
  { value: 'DRIVING', label: 'Driving' },
  { value: 'WALKING', label: 'Walking' },
  { value: 'BICYCLING', label: 'Bicycling' },
  { value: 'TRANSIT', label: 'Transit' },
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

export function createDefaultRouteDraft(): RouteRequestDraft {
  return {
    origin: createLocationDraft('東京駅、日本'),
    intermediates: [],
    destination: createLocationDraft('東京タワー、日本'),
    travelMode: 'DRIVING',
    computeAlternativeRoutes: false,
    departureTime: '',
    languageCode: 'ja',
    regionCode: 'JP',
    routingPreference: '',
  };
}

export function buildRouteRequest(draft: RouteRequestDraft): RouteRequest {
  const intermediates = draft.intermediates
    .filter((location) => !isEmptyLocation(location))
    .map((location, index) =>
      toRouteLocation(location, `Intermediate ${index + 1}`),
    );
  if (intermediates.length > 25) {
    throw new Error('Intermediates must contain at most 25 locations.');
  }

  return {
    origin: toRouteLocation(draft.origin, 'Origin'),
    intermediates,
    destination: toRouteLocation(draft.destination, 'Destination'),
    travelMode: draft.travelMode,
    computeAlternativeRoutes: draft.computeAlternativeRoutes,
    ...(draft.departureTime
      ? { departureTime: new Date(draft.departureTime).toISOString() }
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
    throw new Error('Raw request must be a JSON object.');
  }
  const input = parsed as Record<string, unknown>;
  if (!input.origin) throw new Error('Raw request origin is required.');
  if (!input.destination)
    throw new Error('Raw request destination is required.');
  const travelMode = input.travelMode;
  if (
    typeof travelMode !== 'string' ||
    !ROUTE_MODES.some((mode) => mode.value === travelMode.toUpperCase())
  ) {
    throw new Error('Raw request travelMode is invalid.');
  }
  return parsed;
}

function isEmptyLocation(location: RouteLocationDraft) {
  if (location.type === 'address') return !location.address.trim();
  if (location.type === 'placeId') return !location.placeId.trim();
  return !location.latitude.trim() && !location.longitude.trim();
}

function toRouteLocation(
  value: RouteLocationDraft,
  label: string,
): RouteLocation {
  if (value.type === 'address') {
    if (!value.address.trim()) throw new Error(`${label} address is required.`);
    return { type: 'address', address: value.address.trim() };
  }
  if (value.type === 'placeId') {
    if (!value.placeId.trim())
      throw new Error(`${label} Place ID is required.`);
    return { type: 'placeId', placeId: value.placeId.trim() };
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
    throw new Error(`${label} coordinates are invalid.`);
  }
  return { type: 'coordinates', latitude, longitude };
}
