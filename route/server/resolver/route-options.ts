import type { RouteProviderName } from '../providers/provider.js';
import type { NormalizedRouteRequest } from '../types/route.js';

const TRAFFIC_UNAWARE_DEPARTURE_TIME_MESSAGE =
  'departureTime cannot be used with TRAFFIC_UNAWARE. Remove departureTime or use TRAFFIC_AWARE.';

export class RouteOptionsValidationError extends Error {
  readonly code = 'INVALID_ROUTE_OPTIONS' as const;

  constructor(message = TRAFFIC_UNAWARE_DEPARTURE_TIME_MESSAGE) {
    super(message);
    this.name = 'RouteOptionsValidationError';
  }
}

/** Applies provider-dependent defaults only after provider selection. */
export function normalizeRouteOptionsForProvider(
  request: NormalizedRouteRequest,
  provider: RouteProviderName | string,
): NormalizedRouteRequest {
  if (provider !== 'google' || request.travelMode !== 'DRIVING') {
    return request;
  }

  const routingPreference = request.routingPreference?.toUpperCase();
  if (request.departureTime && routingPreference === 'TRAFFIC_UNAWARE') {
    throw new RouteOptionsValidationError();
  }

  if (request.departureTime && !routingPreference) {
    return { ...request, routingPreference: 'TRAFFIC_AWARE' };
  }
  if (routingPreference && routingPreference !== request.routingPreference) {
    return { ...request, routingPreference };
  }
  return request;
}
