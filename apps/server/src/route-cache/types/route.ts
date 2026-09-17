export interface RoutePoint {
  placeId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface RouteJobRequest {
  origin: RoutePoint;
  destination: RoutePoint;
  waypoints: RoutePoint[];
  travelMode: string;
  departureTime?: string;
  options: Record<string, unknown>;
}

export type NormalizedRouteRequest = RouteJobRequest;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePoint(value: unknown, field: string): RoutePoint {
  if (!isObject(value)) throw new Error(`${field} must be an object`);

  const placeId = typeof value.placeId === 'string' ? value.placeId.trim() : '';
  const address = typeof value.address === 'string' ? value.address.trim() : '';
  const latitude = value.latitude;
  const longitude = value.longitude;
  const hasCoordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;

  if (!placeId && !address && !hasCoordinates) {
    throw new Error(
      `${field} requires placeId, address, or valid latitude/longitude`,
    );
  }

  if (placeId) return { placeId };
  if (address) return { address };
  return { latitude: latitude as number, longitude: longitude as number };
}

export function normalizeRouteRequest(value: unknown): NormalizedRouteRequest {
  if (!isObject(value)) throw new Error('Request body must be an object');

  const travelMode =
    typeof value.travelMode === 'string'
      ? value.travelMode.trim().toUpperCase()
      : '';
  if (!travelMode) throw new Error('travelMode is required');

  const waypoints = value.waypoints ?? [];
  if (!Array.isArray(waypoints)) throw new Error('waypoints must be an array');

  const departureTime =
    typeof value.departureTime === 'string'
      ? value.departureTime.trim()
      : undefined;
  if (departureTime && Number.isNaN(Date.parse(departureTime))) {
    throw new Error('departureTime must be an ISO-8601 date-time');
  }

  const options = value.options ?? {};
  if (!isObject(options)) throw new Error('options must be an object');

  return {
    origin: normalizePoint(value.origin, 'origin'),
    destination: normalizePoint(value.destination, 'destination'),
    waypoints: waypoints.map((point, index) =>
      normalizePoint(point, `waypoints[${index}]`),
    ),
    travelMode,
    ...(departureTime ? { departureTime } : {}),
    options,
  };
}
