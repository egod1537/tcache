import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
} from '../../types/route.js';
import { RouteLocationValidationError } from '../location-validation.js';
import type { NavitimeRequestSpec } from './types.js';

export const DEFAULT_NAVITIME_API_BASE_URL =
  'https://navitime-route-totalnavi.p.rapidapi.com';

const NAVITIME_LANGUAGES = new Set(['ja', 'en', 'ko', 'zh-CN', 'zh-TW', 'th']);

export function toNavitimeTransitRequest(
  request: NormalizedRouteRequest,
  apiBaseUrl = DEFAULT_NAVITIME_API_BASE_URL,
): NavitimeRequestSpec {
  if (request.travelMode !== 'TRANSIT') {
    throw new Error('NAVITIME route provider only supports TRANSIT');
  }
  if (!request.departureTime) {
    throw new Error('NAVITIME route provider requires departureTime');
  }
  if (request.intermediates.length > 10) {
    throw new Error('NAVITIME route provider supports at most 10 waypoints');
  }

  const query = new URLSearchParams({
    start: routeEndpoint(request.origin, 'origin'),
    goal: routeEndpoint(request.destination, 'destination'),
    start_time: formatJapanLocalDateTime(request.departureTime),
    datum: 'wgs84',
    coord_unit: 'degree',
    shape: 'true',
    options: 'railway_calling_at',
  });
  if (request.intermediates.length) {
    query.set(
      'via',
      JSON.stringify(
        request.intermediates.map((location, index) =>
          viaLocation(location, `intermediates[${index}]`),
        ),
      ),
    );
    query.set('via_type', 'specified');
  }
  if (request.languageCode && NAVITIME_LANGUAGES.has(request.languageCode)) {
    query.set('lang', request.languageCode);
  }

  const normalizedBaseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  return {
    url: normalizedBaseUrl.endsWith('/route_transit')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/route_transit`,
    query,
  };
}

export function formatJapanLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('NAVITIME departureTime must be a valid date-time');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function routeEndpoint(location: NormalizedRouteLocation, field: string) {
  if (location.externalIds?.navitimeId) {
    return location.externalIds.navitimeId;
  }
  if (location.coordinates) {
    return `${location.coordinates.latitude},${location.coordinates.longitude}`;
  }
  throw unsupportedLocation(field);
}

function viaLocation(location: NormalizedRouteLocation, field: string) {
  if (location.externalIds?.navitimeId) {
    return {
      node: location.externalIds.navitimeId,
      ...(location.name ? { name: location.name } : {}),
    };
  }
  if (location.coordinates) {
    return {
      lat: location.coordinates.latitude,
      lon: location.coordinates.longitude,
      ...(location.name ? { name: location.name } : {}),
    };
  }
  throw unsupportedLocation(field);
}

function unsupportedLocation(field: string) {
  return new RouteLocationValidationError(
    `${field} cannot be used with navitime: navitimeId or coordinates are required`,
  );
}
