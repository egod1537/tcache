export const ROUTE_TRAVEL_MODES = [
  'DRIVING',
  'WALKING',
  'BICYCLING',
  'TRANSIT',
] as const;

export type RouteTravelMode = (typeof ROUTE_TRAVEL_MODES)[number];

/** Public input shape. Legacy requests without `type` remain accepted. */
export interface RoutePoint {
  type?: string;
  placeId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
}

export interface RouteJobRequest {
  origin: RoutePoint;
  destination: RoutePoint;
  intermediates?: RoutePoint[];
  /** @deprecated Use intermediates. Kept for existing clients. */
  waypoints?: RoutePoint[];
  travelMode: string;
  computeAlternativeRoutes?: boolean;
  departureTime?: string;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
  options?: Record<string, unknown>;
}

export type NormalizedRouteLocation =
  | { type: 'address'; address: string }
  | { type: 'coordinates'; latitude: number; longitude: number }
  | { type: 'placeId'; placeId: string };

export interface NormalizedRouteRequest {
  origin: NormalizedRouteLocation;
  destination: NormalizedRouteLocation;
  intermediates: NormalizedRouteLocation[];
  /** Legacy alias retained so old provider/cache consumers do not break. */
  waypoints: NormalizedRouteLocation[];
  travelMode: RouteTravelMode;
  computeAlternativeRoutes: boolean;
  departureTime?: string;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
  options: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, fallback: unknown): string | undefined {
  const candidate = typeof value === 'string' ? value : fallback;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function normalizePoint(
  value: unknown,
  field: string,
): NormalizedRouteLocation {
  if (!isObject(value)) throw new Error(`${field} must be an object`);

  const type =
    typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
  const placeId = typeof value.placeId === 'string' ? value.placeId.trim() : '';
  const address = typeof value.address === 'string' ? value.address.trim() : '';
  const latitude = value.latitude ?? value.lat;
  const longitude = value.longitude ?? value.lng;
  const hasCoordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;

  if (type === 'address' && !address) {
    throw new Error(`${field}.address is required`);
  }
  if ((type === 'place' || type === 'placeid') && !placeId) {
    throw new Error(`${field}.placeId is required`);
  }
  if (
    ['coordinates', 'coordinate', 'latlng', 'latitudelongitude'].includes(
      type,
    ) &&
    !hasCoordinates
  ) {
    throw new Error(`${field} requires valid latitude/longitude`);
  }

  if (type === 'address' || (!type && address)) {
    return { type: 'address', address };
  }
  if (type === 'place' || type === 'placeid' || (!type && placeId)) {
    return { type: 'placeId', placeId };
  }
  if (hasCoordinates) {
    return {
      type: 'coordinates',
      latitude: latitude as number,
      longitude: longitude as number,
    };
  }

  throw new Error(
    `${field} requires an address, placeId, or valid latitude/longitude`,
  );
}

export function normalizeRouteRequest(value: unknown): NormalizedRouteRequest {
  if (!isObject(value)) throw new Error('Request body must be an object');

  const travelMode =
    typeof value.travelMode === 'string'
      ? value.travelMode.trim().toUpperCase()
      : '';
  if (!ROUTE_TRAVEL_MODES.includes(travelMode as RouteTravelMode)) {
    throw new Error(
      `travelMode must be one of ${ROUTE_TRAVEL_MODES.join(', ')}`,
    );
  }

  const inputIntermediates = value.intermediates ?? value.waypoints ?? [];
  if (!Array.isArray(inputIntermediates)) {
    throw new Error('intermediates must be an array');
  }
  if (inputIntermediates.length > 25) {
    throw new Error('intermediates must contain at most 25 locations');
  }

  const departureTime = optionalString(value.departureTime, undefined);
  if (departureTime && Number.isNaN(Date.parse(departureTime))) {
    throw new Error('departureTime must be an ISO-8601 date-time');
  }

  const options = value.options ?? {};
  if (!isObject(options)) throw new Error('options must be an object');
  const intermediates = inputIntermediates.map((point, index) =>
    normalizePoint(point, `intermediates[${index}]`),
  );
  const computeAlternativeRoutes =
    typeof value.computeAlternativeRoutes === 'boolean'
      ? value.computeAlternativeRoutes
      : typeof options.computeAlternativeRoutes === 'boolean'
        ? options.computeAlternativeRoutes
        : false;
  const languageCode = optionalString(value.languageCode, options.languageCode);
  const regionCode = optionalString(value.regionCode, options.regionCode);
  const routingPreference = optionalString(
    value.routingPreference,
    options.routingPreference,
  );
  if (routingPreference && travelMode !== 'DRIVING') {
    throw new Error('routingPreference is only supported for DRIVING');
  }
  const units = optionalString(value.units, options.units);

  return {
    origin: normalizePoint(value.origin, 'origin'),
    destination: normalizePoint(value.destination, 'destination'),
    intermediates,
    waypoints: intermediates,
    travelMode: travelMode as RouteTravelMode,
    computeAlternativeRoutes,
    ...(departureTime ? { departureTime } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(regionCode ? { regionCode } : {}),
    ...(routingPreference ? { routingPreference } : {}),
    ...(units ? { units } : {}),
    options,
  };
}
