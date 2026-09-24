export const ROUTE_TRAVEL_MODES = [
  'DRIVING',
  'WALKING',
  'BICYCLING',
  'TRANSIT',
] as const;

export type RouteTravelMode = (typeof ROUTE_TRAVEL_MODES)[number];

export interface RouteCoordinates {
  latitude: number;
  longitude: number;
}

export interface RouteExternalIds {
  googlePlaceId?: string;
  kakaoPlaceId?: string;
  navitimeId?: string;
  ekispertId?: string;
}

/** Provider-independent location used inside tcache. */
export interface RouteLocation {
  coordinates?: RouteCoordinates;
  name?: string;
  address?: string;
  externalIds?: RouteExternalIds;
}

/** A location accepted by both the preferred public and legacy contracts. */
export interface RoutePoint extends RouteLocation {
  type?: string;
  /** @deprecated Use externalIds.googlePlaceId. */
  placeId?: string;
  /** @deprecated Use coordinates.latitude. */
  latitude?: number;
  /** @deprecated Use coordinates.longitude. */
  longitude?: number;
  lat?: number;
  lng?: number;
}

export type PublicRouteLocation = RoutePoint;

export interface PublicRouteRequest {
  locations: PublicRouteLocation[];
  mode: RouteTravelMode;
  departureTime: string;
  countryCode?: string;
  timeZone?: string;
  provider?: string;
  computeAlternativeRoutes?: boolean;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
  options?: Record<string, unknown>;
}

/** Legacy request shape retained for existing clients. */
export interface RouteJobRequest {
  origin: RoutePoint;
  destination: RoutePoint;
  intermediates?: RoutePoint[];
  /** @deprecated Use intermediates. Kept for existing clients. */
  waypoints?: RoutePoint[];
  travelMode: string;
  countryCode?: string;
  timeZone?: string;
  provider?: string;
  computeAlternativeRoutes?: boolean;
  departureTime?: string;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
  options?: Record<string, unknown>;
}

export type RouteRequestInput = PublicRouteRequest | RouteJobRequest;

/** @deprecated Prefer RouteLocation. */
export type NormalizedRouteLocation = RouteLocation;

export interface NormalizedRouteRequest {
  origin: NormalizedRouteLocation;
  destination: NormalizedRouteLocation;
  intermediates: NormalizedRouteLocation[];
  /** Legacy alias retained so old provider/cache consumers do not break. */
  waypoints: NormalizedRouteLocation[];
  travelMode: RouteTravelMode;
  countryCode?: string;
  timeZone?: string;
  provider?: string;
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

const ISO_DATE_TIME_WITH_TIME_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;

function normalizePoint(
  value: unknown,
  field: string,
): NormalizedRouteLocation {
  if (!isObject(value)) throw new Error(`${field} must be an object`);

  const type =
    typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
  const name = normalizeOptionalLocationString(value.name, `${field}.name`);
  const address = normalizeOptionalLocationString(
    value.address,
    `${field}.address`,
  );
  const coordinates = normalizeCoordinates(value, field);
  const externalIds = normalizeExternalIds(value, field);

  if (type === 'address' && !address) {
    throw new Error(`${field}.address is required`);
  }
  if ((type === 'place' || type === 'placeid') && !externalIds?.googlePlaceId) {
    throw new Error(`${field}.placeId is required`);
  }
  if (
    ['coordinates', 'coordinate', 'latlng', 'latitudelongitude'].includes(
      type,
    ) &&
    !coordinates
  ) {
    throw new Error(`${field} requires valid latitude/longitude`);
  }

  if (!coordinates && !name && !address && !hasExternalId(externalIds)) {
    throw new Error(
      `${field} requires coordinates, a name, an address, or an external place ID`,
    );
  }

  return {
    ...(coordinates ? { coordinates } : {}),
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
    ...(externalIds ? { externalIds } : {}),
  };
}

function normalizeCoordinates(
  value: Record<string, unknown>,
  field: string,
): RouteCoordinates | undefined {
  const nested = value.coordinates;
  if (nested !== undefined && !isObject(nested)) {
    throw new Error(`${field}.coordinates must be an object`);
  }

  const source = isObject(nested) ? nested : value;
  const latitude = source.latitude ?? source.lat;
  const longitude = source.longitude ?? source.lng;
  const hasLatitude = latitude !== undefined;
  const hasLongitude = longitude !== undefined;
  if (!hasLatitude && !hasLongitude) return undefined;
  if (!hasLatitude || !hasLongitude) {
    throw new Error(`${field} requires both latitude and longitude`);
  }
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    throw new Error(`${field}.latitude must be a finite number`);
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error(`${field}.latitude must be between -90 and 90`);
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw new Error(`${field}.longitude must be a finite number`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`${field}.longitude must be between -180 and 180`);
  }
  return { latitude, longitude };
}

function normalizeExternalIds(
  value: Record<string, unknown>,
  field: string,
): RouteExternalIds | undefined {
  const raw = value.externalIds;
  if (raw !== undefined && !isObject(raw)) {
    throw new Error(`${field}.externalIds must be an object`);
  }
  const externalIds = isObject(raw) ? raw : {};
  const legacyGooglePlaceId = normalizeOptionalLocationString(
    value.placeId,
    `${field}.placeId`,
  );
  const googlePlaceId = normalizeOptionalLocationString(
    externalIds.googlePlaceId,
    `${field}.externalIds.googlePlaceId`,
  );
  const kakaoPlaceId = normalizeOptionalLocationString(
    externalIds.kakaoPlaceId,
    `${field}.externalIds.kakaoPlaceId`,
  );
  const navitimeId = normalizeOptionalLocationString(
    externalIds.navitimeId,
    `${field}.externalIds.navitimeId`,
  );
  const ekispertId = normalizeOptionalLocationString(
    externalIds.ekispertId,
    `${field}.externalIds.ekispertId`,
  );
  const normalizedGooglePlaceId = googlePlaceId ?? legacyGooglePlaceId;
  const normalized = {
    ...(normalizedGooglePlaceId
      ? { googlePlaceId: normalizedGooglePlaceId }
      : {}),
    ...(kakaoPlaceId ? { kakaoPlaceId } : {}),
    ...(navitimeId ? { navitimeId } : {}),
    ...(ekispertId ? { ekispertId } : {}),
  };
  return hasExternalId(normalized) ? normalized : undefined;
}

function normalizeOptionalLocationString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value.trim() || undefined;
}

function hasExternalId(
  externalIds: RouteExternalIds | undefined,
): externalIds is RouteExternalIds {
  return Boolean(
    externalIds?.googlePlaceId ||
    externalIds?.kakaoPlaceId ||
    externalIds?.navitimeId ||
    externalIds?.ekispertId,
  );
}

/**
 * Normalizes the preferred ordered-locations contract and the legacy
 * origin/intermediates/destination contract into one internal request.
 */
export function normalizePublicRouteRequest(
  value: unknown,
): NormalizedRouteRequest {
  if (!isObject(value)) throw new Error('Request body must be an object');

  return 'locations' in value || 'mode' in value
    ? normalizeOrderedRequest(value)
    : normalizeLegacyRequest(value);
}

/** Backwards-compatible name used by existing provider and job code. */
export function normalizeRouteRequest(value: unknown): NormalizedRouteRequest {
  return normalizePublicRouteRequest(value);
}

function normalizeOrderedRequest(
  value: Record<string, unknown>,
): NormalizedRouteRequest {
  if (!Array.isArray(value.locations)) {
    throw new Error('locations must be an array');
  }
  if (value.locations.length < 2 || value.locations.length > 27) {
    throw new Error('locations must contain between 2 and 27 items');
  }

  const mode = normalizeTravelMode(value.mode, 'mode');
  const departureTime = normalizeDepartureTime(value.departureTime, true);
  const locations = value.locations.map((point, index) =>
    normalizePoint(point, `locations[${index}]`),
  );
  const origin = locations[0];
  const destination = locations.at(-1);
  if (!origin || !destination) {
    throw new Error('locations must contain between 2 and 27 items');
  }

  return createNormalizedRequest({
    value,
    origin,
    intermediates: locations.slice(1, -1),
    destination,
    travelMode: mode,
    departureTime,
  });
}

function normalizeLegacyRequest(
  value: Record<string, unknown>,
): NormalizedRouteRequest {
  const travelMode = normalizeTravelMode(value.travelMode, 'travelMode');

  const inputIntermediates = value.intermediates ?? value.waypoints ?? [];
  if (!Array.isArray(inputIntermediates)) {
    throw new Error('intermediates must be an array');
  }
  if (inputIntermediates.length > 25) {
    throw new Error('intermediates must contain at most 25 locations');
  }

  const departureTime = normalizeDepartureTime(value.departureTime, false);

  return createNormalizedRequest({
    value,
    origin: normalizePoint(value.origin, 'origin'),
    intermediates: inputIntermediates.map((point, index) =>
      normalizePoint(point, `intermediates[${index}]`),
    ),
    destination: normalizePoint(value.destination, 'destination'),
    travelMode,
    ...(departureTime ? { departureTime } : {}),
  });
}

function createNormalizedRequest(input: {
  value: Record<string, unknown>;
  origin: NormalizedRouteLocation;
  intermediates: NormalizedRouteLocation[];
  destination: NormalizedRouteLocation;
  travelMode: RouteTravelMode;
  departureTime?: string;
}): NormalizedRouteRequest {
  const { value, origin, intermediates, destination, travelMode } = input;

  const options = value.options ?? {};
  if (!isObject(options)) throw new Error('options must be an object');
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
  const countryCode = normalizeCountryCode(value.countryCode);
  const timeZone = normalizeTimeZone(value.timeZone);
  const provider = optionalString(value.provider, undefined)?.toLowerCase();

  return {
    origin,
    destination,
    intermediates,
    waypoints: intermediates,
    travelMode: travelMode as RouteTravelMode,
    ...(countryCode ? { countryCode } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(provider ? { provider } : {}),
    computeAlternativeRoutes,
    ...(input.departureTime ? { departureTime: input.departureTime } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(regionCode ? { regionCode } : {}),
    ...(routingPreference ? { routingPreference } : {}),
    ...(units ? { units } : {}),
    options,
  };
}

function normalizeTimeZone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('timeZone must be a valid IANA timezone');
  }
  const timeZone = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new Error('timeZone must be a valid IANA timezone');
  }
  return timeZone;
}

function normalizeCountryCode(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-z]{2}$/i.test(value.trim())) {
    throw new Error('countryCode must be an ISO 3166-1 alpha-2 code');
  }
  return value.trim().toUpperCase();
}

function normalizeTravelMode(value: unknown, field: string): RouteTravelMode {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROUTE_TRAVEL_MODES.includes(normalized as RouteTravelMode)) {
    throw new Error(`${field} must be one of ${ROUTE_TRAVEL_MODES.join(', ')}`);
  }
  return normalized as RouteTravelMode;
}

function normalizeDepartureTime(value: unknown, requireTimeZone: true): string;
function normalizeDepartureTime(
  value: unknown,
  requireTimeZone: false,
): string | undefined;
function normalizeDepartureTime(
  value: unknown,
  requireTimeZone: boolean,
): string | undefined {
  const departureTime = optionalString(value, undefined);
  if (!departureTime) {
    if (requireTimeZone) throw new Error('departureTime is required');
    return undefined;
  }
  if (
    (requireTimeZone && !isValidZonedDateTime(departureTime)) ||
    (!requireTimeZone && Number.isNaN(Date.parse(departureTime)))
  ) {
    throw new Error(
      requireTimeZone
        ? 'departureTime must be an ISO-8601 date-time with a timezone offset'
        : 'departureTime must be an ISO-8601 date-time',
    );
  }
  return departureTime;
}

function isValidZonedDateTime(value: string) {
  const match = ISO_DATE_TIME_WITH_TIME_ZONE.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const wallClock = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  return (
    wallClock.getUTCFullYear() === Number(year) &&
    wallClock.getUTCMonth() === Number(month) - 1 &&
    wallClock.getUTCDate() === Number(day) &&
    wallClock.getUTCHours() === Number(hour) &&
    wallClock.getUTCMinutes() === Number(minute) &&
    wallClock.getUTCSeconds() === Number(second)
  );
}
