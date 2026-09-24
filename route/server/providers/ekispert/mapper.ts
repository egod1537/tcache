import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
} from '../../types/route.js';
import { RouteLocationValidationError } from '../location-validation.js';
import type { EkispertRequestSpec } from './types.js';

export const DEFAULT_EKISPERT_API_BASE_URL = 'https://api.ekispert.jp';
export const EKISPERT_MAX_LOCATIONS = 20;

export function toEkispertTransitRequest(
  request: NormalizedRouteRequest,
  apiBaseUrl = DEFAULT_EKISPERT_API_BASE_URL,
): EkispertRequestSpec {
  if (request.travelMode !== 'TRANSIT') {
    throw new Error('Ekispert route provider only supports TRANSIT');
  }
  if (!request.departureTime) {
    throw new Error('Ekispert route provider requires departureTime');
  }
  const locations = [
    request.origin,
    ...request.intermediates,
    request.destination,
  ];
  if (locations.length > EKISPERT_MAX_LOCATIONS) {
    throw new Error(
      `Ekispert route provider supports at most ${EKISPERT_MAX_LOCATIONS} locations`,
    );
  }
  const temporal = formatJapanDepartureTime(request.departureTime);
  const query = new URLSearchParams({
    viaList: locations
      .map((location, index) =>
        routePoint(location, locationField(index, locations.length)),
      )
      .join(':'),
    date: temporal.date,
    time: temporal.time,
    searchType: 'departure',
    sort: 'ekispert',
    answerCount: request.computeAlternativeRoutes ? '5' : '1',
    searchCount: request.computeAlternativeRoutes ? '5' : '1',
    gcs: 'wgs84',
    addStop: 'true',
    resultDetail: 'addCorporation',
  });
  const normalizedBaseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  return {
    url: normalizedBaseUrl.endsWith('/v1/json/search/course/extreme')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1/json/search/course/extreme`,
    query,
  };
}

export function formatJapanDepartureTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Ekispert departureTime must be a valid date-time');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}${part('month')}${part('day')}`,
    time: `${part('hour')}${part('minute')}`,
  };
}

function routePoint(location: NormalizedRouteLocation, field: string) {
  const value =
    location.externalIds?.ekispertId ??
    (location.coordinates
      ? `${location.coordinates.latitude},${location.coordinates.longitude},wgs84`
      : (location.address ?? location.name));
  if (!value) {
    throw new RouteLocationValidationError(
      `${field} cannot be used with ekispert: ekispertId, coordinates, address, or name is required`,
    );
  }
  if (value.includes(':')) {
    throw new RouteLocationValidationError(
      `${field} cannot contain ':' when used with ekispert`,
    );
  }
  return value;
}

function locationField(index: number, length: number) {
  if (index === 0) return 'origin';
  if (index === length - 1) return 'destination';
  return `intermediates[${index - 1}]`;
}
