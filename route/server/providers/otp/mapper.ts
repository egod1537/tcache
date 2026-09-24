import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
} from '../../types/route.js';
import { OTP_PLAN_QUERY } from './query.js';
import type { OtpLabeledLocation, OtpRequestSpec } from './types.js';

export const DEFAULT_OTP_BASE_URL = 'http://localhost:8080';
export const OTP_MAX_LOCATIONS = 2;

export function toOtpTransitRequest(
  request: NormalizedRouteRequest,
  baseUrl = DEFAULT_OTP_BASE_URL,
): OtpRequestSpec {
  if (request.travelMode !== 'TRANSIT') {
    throw new Error('OTP only supports TRANSIT requests');
  }
  if (request.intermediates.length) {
    throw new Error('OTP does not support waypoints');
  }
  if (!request.departureTime) {
    throw new Error('OTP requires departureTime');
  }
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/otp/gtfs/v1`,
    language: normalizeLanguage(request.languageCode),
    body: {
      operationName: 'PlanTokyo',
      query: OTP_PLAN_QUERY,
      variables: {
        origin: toOtpLocation(request.origin, 'origin'),
        destination: toOtpLocation(request.destination, 'destination'),
        dateTime: { earliestDeparture: request.departureTime },
        first: request.computeAlternativeRoutes ? 3 : 1,
      },
    },
  };
}

function toOtpLocation(
  location: NormalizedRouteLocation,
  fallbackLabel: string,
): OtpLabeledLocation {
  if (!location.coordinates) {
    throw new Error(`${fallbackLabel} coordinates are required for OTP`);
  }
  return {
    label: location.name ?? location.address ?? fallbackLabel,
    location: { coordinate: location.coordinates },
  };
}

function normalizeLanguage(languageCode: string | undefined) {
  const language = languageCode?.trim().split(/[-_]/)[0]?.toLowerCase();
  return language || 'ja';
}
