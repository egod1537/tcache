import type { NormalizedRouteRequest, RoutePoint } from '../../types/route.js';
import type { GoogleRoutesRequest, GoogleWaypoint } from './types.js';

function toWaypoint(point: RoutePoint): GoogleWaypoint {
  if (point.placeId) return { placeId: point.placeId };
  if (point.address) return { address: point.address };
  return {
    location: {
      latLng: {
        latitude: point.latitude!,
        longitude: point.longitude!,
      },
    },
  };
}

export function toGoogleRoutesRequest(
  request: NormalizedRouteRequest,
): GoogleRoutesRequest {
  const { options } = request;
  return {
    origin: toWaypoint(request.origin),
    destination: toWaypoint(request.destination),
    ...(request.waypoints.length
      ? { intermediates: request.waypoints.map(toWaypoint) }
      : {}),
    travelMode: request.travelMode,
    ...(request.departureTime ? { departureTime: request.departureTime } : {}),
    ...(typeof options.computeAlternativeRoutes === 'boolean'
      ? { computeAlternativeRoutes: options.computeAlternativeRoutes }
      : {}),
    ...(typeof options.languageCode === 'string'
      ? { languageCode: options.languageCode }
      : {}),
    ...(typeof options.units === 'string' ? { units: options.units } : {}),
  };
}
