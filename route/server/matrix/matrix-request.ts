import {
  normalizeRouteRequest,
  type NormalizedRouteLocation,
  type NormalizedRouteRequest,
  type RouteTravelMode,
} from '../types/route.js';

export const MIN_MATRIX_LOCATIONS = 2;
export const MAX_MATRIX_LOCATIONS = 20;

export interface MatrixLocation {
  id: string;
  coordinates?: { latitude: number; longitude: number };
  externalIds?: {
    googlePlaceId?: string;
    kakaoPlaceId?: string;
    navitimeId?: string;
    ekispertId?: string;
  };
  name?: string;
  placeId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface MatrixRequest {
  locations: MatrixLocation[];
  mode: RouteTravelMode;
  departureTime: string;
  countryCode?: string;
  timeZone?: string;
  provider?: string;
  options: {
    languageCode?: string;
    regionCode?: string;
    routingPreference?: string;
    units?: string;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeMatrixRequest(value: unknown): MatrixRequest {
  const input = record(value);
  if (!input) throw new Error('Request body must be an object');
  if (!Array.isArray(input.locations)) {
    throw new Error('locations must be an array');
  }
  if (
    input.locations.length < MIN_MATRIX_LOCATIONS ||
    input.locations.length > MAX_MATRIX_LOCATIONS
  ) {
    throw new Error(
      `locations must contain between ${MIN_MATRIX_LOCATIONS} and ${MAX_MATRIX_LOCATIONS} items`,
    );
  }

  const options = input.options === undefined ? {} : record(input.options);
  if (!options) throw new Error('options must be an object');
  const ids = new Set<string>();
  const locations = input.locations.map((value, index) => {
    const location = record(value);
    if (!location) throw new Error(`locations[${index}] must be an object`);
    const id = typeof location.id === 'string' ? location.id.trim() : '';
    if (!id) throw new Error(`locations[${index}].id is required`);
    if (ids.has(id)) throw new Error(`location id must be unique: ${id}`);
    ids.add(id);

    const normalized = normalizeRouteRequest({
      origin: location,
      destination: location,
      travelMode: input.mode,
      departureTime: input.departureTime,
    }).origin;
    return { id, ...toPublicLocation(normalized) };
  });

  const normalizedPair = normalizeRouteRequest({
    locations: [locations[0], locations[1]],
    mode: input.mode,
    departureTime: input.departureTime,
    countryCode: input.countryCode,
    timeZone: input.timeZone,
    provider: input.provider,
    options,
  });
  if (!normalizedPair.departureTime) {
    throw new Error('departureTime is required');
  }

  return {
    locations,
    mode: normalizedPair.travelMode,
    departureTime: normalizedPair.departureTime,
    ...(normalizedPair.countryCode
      ? { countryCode: normalizedPair.countryCode }
      : {}),
    ...(normalizedPair.timeZone ? { timeZone: normalizedPair.timeZone } : {}),
    ...(normalizedPair.provider ? { provider: normalizedPair.provider } : {}),
    options: {
      ...(normalizedPair.languageCode
        ? { languageCode: normalizedPair.languageCode }
        : {}),
      ...(normalizedPair.regionCode
        ? { regionCode: normalizedPair.regionCode }
        : {}),
      ...(normalizedPair.routingPreference
        ? { routingPreference: normalizedPair.routingPreference }
        : {}),
      ...(normalizedPair.units ? { units: normalizedPair.units } : {}),
    },
  };
}

function toPublicLocation(location: NormalizedRouteLocation) {
  return {
    ...(location.coordinates ? { coordinates: location.coordinates } : {}),
    ...(location.name ? { name: location.name } : {}),
    ...(location.address ? { address: location.address } : {}),
    ...(location.externalIds ? { externalIds: location.externalIds } : {}),
  };
}

export function toPairRouteRequest(
  request: MatrixRequest,
  from: MatrixLocation,
  to: MatrixLocation,
): NormalizedRouteRequest {
  return normalizeRouteRequest({
    origin: from,
    destination: to,
    travelMode: request.mode,
    departureTime: request.departureTime,
    countryCode: request.countryCode,
    timeZone: request.timeZone,
    provider: request.provider,
    languageCode: request.options.languageCode,
    regionCode: request.options.regionCode,
    routingPreference: request.options.routingPreference,
    units: request.options.units,
  });
}
