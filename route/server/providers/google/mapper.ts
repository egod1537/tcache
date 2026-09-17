import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
  RouteRequestInput,
  RouteTravelMode,
} from '../../types/route.js';
import { normalizeRouteRequest } from '../../types/route.js';
import type { GoogleRoutesRequest, GoogleWaypoint } from './types.js';

const GOOGLE_TRAVEL_MODES: Record<
  RouteTravelMode,
  GoogleRoutesRequest['travelMode']
> = {
  DRIVING: 'DRIVE',
  WALKING: 'WALK',
  BICYCLING: 'BICYCLE',
  TRANSIT: 'TRANSIT',
};

function toWaypoint(point: NormalizedRouteLocation): GoogleWaypoint {
  if (point.type === 'placeId') return { placeId: point.placeId };
  if (point.type === 'address') return { address: point.address };
  return {
    location: {
      latLng: {
        latitude: point.latitude,
        longitude: point.longitude,
      },
    },
  };
}

export function toGoogleRoutesRequest(
  request: NormalizedRouteRequest | RouteRequestInput,
): GoogleRoutesRequest {
  const normalized = normalizeRouteRequest(request);
  return {
    origin: toWaypoint(normalized.origin),
    destination: toWaypoint(normalized.destination),
    ...(normalized.intermediates.length
      ? { intermediates: normalized.intermediates.map(toWaypoint) }
      : {}),
    travelMode: GOOGLE_TRAVEL_MODES[normalized.travelMode],
    computeAlternativeRoutes: normalized.computeAlternativeRoutes,
    ...(normalized.departureTime
      ? { departureTime: normalized.departureTime }
      : {}),
    ...(normalized.languageCode
      ? { languageCode: normalized.languageCode }
      : {}),
    ...(normalized.regionCode ? { regionCode: normalized.regionCode } : {}),
    ...(normalized.routingPreference
      ? { routingPreference: normalized.routingPreference }
      : {}),
    ...(normalized.units ? { units: normalized.units } : {}),
  };
}
