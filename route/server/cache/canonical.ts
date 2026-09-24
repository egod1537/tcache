import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
  RouteTravelMode,
} from '../types/route.js';

export type RouteDayType = 'weekday' | 'saturday' | 'sunday' | 'holiday';

export const ROUTE_COORDINATE_PRECISION = 5;
export const DEFAULT_ROUTE_TIME_BUCKET_MINUTES = 10;

const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = {
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
};

export interface RouteTimeBucketPolicy {
  readonly minutes: number;
}

const TIME_BUCKET_POLICY_OVERRIDES: Readonly<
  Record<string, RouteTimeBucketPolicy>
> = {};

export interface RouteTemporalMetadata {
  dayType: RouteDayType;
  timeBucket: string;
}

export interface RouteCanonicalizationOptions {
  fallbackTime?: Date;
  timeZone?: string;
  isHoliday?: (date: Date) => boolean;
  provider?: string;
}

export function canonicalizeRouteLocation(
  location: NormalizedRouteLocation,
  provider?: string,
): string {
  if (location.coordinates) {
    return `coord:${formatCoordinate(location.coordinates.latitude)},${formatCoordinate(location.coordinates.longitude)}`;
  }
  const externalId = canonicalExternalId(location, provider);
  if (externalId) return externalId;
  if (location.address) return `address:${normalizeAddress(location.address)}`;
  if (location.name) return `name:${normalizeAddress(location.name)}`;
  throw new Error('Route location cannot be canonicalized');
}

function canonicalExternalId(
  location: NormalizedRouteLocation,
  provider?: string,
) {
  const ids = location.externalIds;
  const providerId = provider?.trim().toLowerCase();
  if (providerId === 'google' && ids?.googlePlaceId) {
    return `external:google:${ids.googlePlaceId.trim()}`;
  }
  if (
    ['kakao', 'kakao-maps', 'kakao-mobility'].includes(providerId ?? '') &&
    ids?.kakaoPlaceId
  ) {
    return `external:kakao:${ids.kakaoPlaceId.trim()}`;
  }
  if (providerId === 'navitime' && ids?.navitimeId) {
    return `external:navitime:${ids.navitimeId.trim()}`;
  }
  if (providerId === 'ekispert' && ids?.ekispertId) {
    return `external:ekispert:${ids.ekispertId.trim()}`;
  }
  if (
    providerId &&
    [
      'google',
      'kakao',
      'kakao-maps',
      'kakao-mobility',
      'navitime',
      'ekispert',
    ].includes(providerId)
  ) {
    return undefined;
  }
  if (ids?.googlePlaceId) return `external:google:${ids.googlePlaceId.trim()}`;
  if (ids?.kakaoPlaceId) return `external:kakao:${ids.kakaoPlaceId.trim()}`;
  if (ids?.navitimeId) return `external:navitime:${ids.navitimeId.trim()}`;
  if (ids?.ekispertId) return `external:ekispert:${ids.ekispertId.trim()}`;
  return undefined;
}

export function getRouteTemporalMetadata(
  request: NormalizedRouteRequest,
  options: RouteCanonicalizationOptions = {},
): RouteTemporalMetadata {
  const date = request.departureTime
    ? new Date(request.departureTime)
    : (options.fallbackTime ?? new Date());
  const timeZone = resolveRouteTimeZone(request, options.timeZone);
  const policy = getTimeBucketPolicy(
    request.travelMode,
    options.provider ?? request.provider,
  );
  return {
    dayType: getRouteDayType(
      date,
      timeZone,
      options.isHoliday?.(date) ?? false,
    ),
    timeBucket: getRouteTimeBucket(date, timeZone, policy),
  };
}

export function resolveRouteTimeZone(
  request: NormalizedRouteRequest,
  fallbackTimeZone?: string,
): string {
  return (
    request.timeZone ??
    (request.countryCode
      ? COUNTRY_TIME_ZONES[request.countryCode]
      : undefined) ??
    fallbackTimeZone ??
    'UTC'
  );
}

/** Kept provider/mode-aware so transit can adopt a narrower bucket independently. */
export function getTimeBucketPolicy(
  mode: RouteTravelMode,
  provider?: string,
): RouteTimeBucketPolicy {
  return (
    TIME_BUCKET_POLICY_OVERRIDES[`${provider ?? '*'}:${mode}`] ??
    TIME_BUCKET_POLICY_OVERRIDES[`*:${mode}`] ?? {
      minutes: DEFAULT_ROUTE_TIME_BUCKET_MINUTES,
    }
  );
}

export function getRouteDayType(
  date: Date,
  timeZone = 'UTC',
  holiday = false,
): RouteDayType {
  if (holiday) return 'holiday';
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  if (weekday === 'Sat') return 'saturday';
  if (weekday === 'Sun') return 'sunday';
  return 'weekday';
}

export function getRouteTimeBucket(
  date: Date,
  timeZone = 'UTC',
  policy: RouteTimeBucketPolicy = {
    minutes: DEFAULT_ROUTE_TIME_BUCKET_MINUTES,
  },
): string {
  if (
    !Number.isInteger(policy.minutes) ||
    policy.minutes < 1 ||
    policy.minutes > 60 ||
    60 % policy.minutes !== 0
  ) {
    throw new Error('Route time bucket minutes must divide one hour');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!hour || !minute)
    throw new Error('Unable to calculate route time bucket');
  const bucket = Math.floor(Number(minute) / policy.minutes) * policy.minutes;
  return `${hour}:${String(bucket).padStart(2, '0')}`;
}

function formatCoordinate(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(ROUTE_COORDINATE_PRECISION);
}

function normalizeAddress(value: string) {
  return value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase();
}
