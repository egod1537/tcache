import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
} from '../types/route.js';

export type RouteDayType = 'weekday' | 'saturday' | 'sunday' | 'holiday';

export const ROUTE_COORDINATE_PRECISION = 5;

export interface RouteTemporalMetadata {
  dayType: RouteDayType;
  timeBucket: string;
}

export interface RouteCanonicalizationOptions {
  fallbackTime?: Date;
  timeZone?: string;
  isHoliday?: (date: Date) => boolean;
}

export function canonicalizeRouteLocation(
  location: NormalizedRouteLocation,
): string {
  if (location.type === 'placeId') return `place:${location.placeId.trim()}`;
  if (location.type === 'coordinates') {
    return `coord:${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`;
  }
  return `address:${normalizeAddress(location.address)}`;
}

export function getRouteTemporalMetadata(
  request: NormalizedRouteRequest,
  options: RouteCanonicalizationOptions = {},
): RouteTemporalMetadata {
  const date = request.departureTime
    ? new Date(request.departureTime)
    : (options.fallbackTime ?? new Date());
  const timeZone = options.timeZone ?? 'UTC';
  return {
    dayType: getRouteDayType(
      date,
      timeZone,
      options.isHoliday?.(date) ?? false,
    ),
    timeBucket: getRouteTimeBucket(date, timeZone),
  };
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

export function getRouteTimeBucket(date: Date, timeZone = 'UTC'): string {
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
  const bucket = Math.floor(Number(minute) / 10) * 10;
  return `${hour}:${String(bucket).padStart(2, '0')}`;
}

function formatCoordinate(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(ROUTE_COORDINATE_PRECISION);
}

function normalizeAddress(value: string) {
  return value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ');
}
