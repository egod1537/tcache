import { RouteLocationValidationError } from '../location-validation.js';
import type {
  NormalizedRouteLocation,
  NormalizedRouteRequest,
  RouteTravelMode,
} from '../../types/route.js';
import type { KakaoRequestSpec } from './types.js';

export const KAKAO_MOBILITY_DIRECTIONS_URL =
  'https://apis-navi.kakaomobility.com/v1/directions';

export const KAKAO_MAPS_MODE_ENDPOINTS: Readonly<
  Record<Exclude<RouteTravelMode, 'DRIVING'>, string>
> = {
  TRANSIT: 'https://dapi.kakao.com/v2/routing/publictraffic',
  WALKING: 'https://dapi.kakao.com/v2/routing/walk',
  BICYCLING: 'https://dapi.kakao.com/v2/routing/bicycle',
};

export function toKakaoMobilityRequest(
  request: NormalizedRouteRequest,
): KakaoRequestSpec {
  if (request.travelMode !== 'DRIVING') {
    throw new Error('Kakao Mobility only supports DRIVING');
  }
  if (request.intermediates.length > 5) {
    throw new Error('Kakao Mobility supports at most 5 waypoints');
  }
  const query = new URLSearchParams({
    origin: mobilityCoordinate(request.origin, 'origin'),
    destination: mobilityCoordinate(request.destination, 'destination'),
    priority: 'RECOMMEND',
    alternatives: String(request.computeAlternativeRoutes),
    summary: 'false',
  });
  if (request.intermediates.length) {
    query.set(
      'waypoints',
      request.intermediates
        .map((location, index) =>
          mobilityCoordinate(location, `intermediates[${index}]`),
        )
        .join('|'),
    );
  }
  return { url: KAKAO_MOBILITY_DIRECTIONS_URL, query };
}

export function toKakaoMapsRequest(
  request: NormalizedRouteRequest,
): KakaoRequestSpec {
  if (request.travelMode === 'DRIVING') {
    throw new Error('Kakao Maps routing does not support DRIVING');
  }
  if (request.travelMode === 'TRANSIT' && request.intermediates.length) {
    throw new Error('Kakao Transit does not support waypoints');
  }
  if (request.intermediates.length > 5) {
    throw new Error(
      'Kakao walking and bicycle routes support at most 5 waypoints',
    );
  }
  const origin = coordinates(request.origin, 'origin');
  const destination = coordinates(request.destination, 'destination');
  const query = new URLSearchParams({
    start_x: String(origin.longitude),
    start_y: String(origin.latitude),
    end_x: String(destination.longitude),
    end_y: String(destination.latitude),
    input_coord: 'WGS84',
    output_coord: 'WGS84',
  });
  if (request.origin.name) query.set('s_name', request.origin.name);
  if (request.destination.name) query.set('e_name', request.destination.name);
  if (request.intermediates.length) {
    const waypoints = request.intermediates.map((location, index) =>
      coordinates(location, `intermediates[${index}]`),
    );
    query.set('via_x', waypoints.map(({ longitude }) => longitude).join(','));
    query.set('via_y', waypoints.map(({ latitude }) => latitude).join(','));
    if (request.intermediates.every((location) => location.name)) {
      query.set(
        'v_name',
        request.intermediates.map((location) => location.name).join(','),
      );
    }
  }
  return { url: KAKAO_MAPS_MODE_ENDPOINTS[request.travelMode], query };
}

function mobilityCoordinate(location: NormalizedRouteLocation, field: string) {
  const value = coordinates(location, field);
  return `${value.longitude},${value.latitude}`;
}

function coordinates(location: NormalizedRouteLocation, field: string) {
  if (!location.coordinates) {
    throw new RouteLocationValidationError(
      `${field} cannot be used with Kakao: coordinates are required`,
    );
  }
  return location.coordinates;
}
