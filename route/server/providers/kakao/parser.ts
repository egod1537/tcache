import type { RouteTravelMode } from '../../types/route.js';
import { createKakaoResponseError } from './errors.js';
import type {
  KakaoNormalizedRoute,
  KakaoNormalizedRouteLeg,
  KakaoNormalizedRouteStep,
  KakaoRouteBounds,
  KakaoRouteCoordinate,
  KakaoRouteResult,
} from './types.js';

export function parseKakaoMobilityResponse(value: unknown): KakaoRouteResult {
  const response = record(value);
  const routes = array(response?.routes);
  if (!response || !routes.length) {
    throw createKakaoResponseError('kakao-mobility', 'INVALID_RESPONSE');
  }

  const successfulRoutes = routes.filter((route) => {
    const resultCode = numberOrNull(record(route)?.result_code);
    return resultCode === null || resultCode === 0;
  });
  if (!successfulRoutes.length) {
    const firstRoute = record(routes[0]);
    throw createKakaoResponseError(
      'kakao-mobility',
      String(firstRoute?.result_code ?? 'NO_ROUTE'),
    );
  }

  return {
    provider: 'kakao-mobility',
    routes: successfulRoutes.map(parseMobilityRoute),
    metadata: {
      upstreamStatus: 'OK',
      ...(typeof response.trans_id === 'string'
        ? { transactionId: response.trans_id }
        : {}),
    },
  };
}

export function parseKakaoMapsResponse(
  value: unknown,
  mode: Exclude<RouteTravelMode, 'DRIVING'>,
): KakaoRouteResult {
  const response = record(value);
  const status = stringOrNull(response?.status) ?? 'INVALID_RESPONSE';
  if (!response || status !== 'OK') {
    throw createKakaoResponseError('kakao-maps', status);
  }

  const routes =
    mode === 'TRANSIT'
      ? array(response.routes).map((route) => parseTransitRoute(route))
      : response.route
        ? [parsePedestrianRoute(response.route, mode)]
        : [];
  if (!routes.length) {
    throw createKakaoResponseError('kakao-maps', 'INVALID_RESPONSE');
  }

  return {
    provider: 'kakao-maps',
    routes,
    metadata: { upstreamStatus: status },
  };
}

function parseMobilityRoute(value: unknown): KakaoNormalizedRoute {
  const route = record(value) ?? {};
  const summary = record(route.summary) ?? {};
  const sections = array(route.sections);
  const legs = sections.map(parseMobilitySection);
  const path = dedupePath(
    sections.flatMap((section) =>
      array(record(section)?.roads).flatMap((road) =>
        flatVertexPath(record(road)?.vertexes),
      ),
    ),
  );
  const priority = stringOrNull(summary.priority);

  return {
    description: priority
      ? `Kakao Mobility ${priority}`
      : 'Kakao Mobility route',
    routeLabels: priority ? [priority] : [],
    distanceMeters: numberOrNull(summary.distance),
    durationSeconds: numberOrNull(summary.duration),
    encodedPolyline: '',
    path,
    bounds: boundsFromPath(path),
    legs,
    warnings: [],
  };
}

function parseMobilitySection(value: unknown): KakaoNormalizedRouteLeg {
  const section = record(value) ?? {};
  const path = dedupePath(
    array(section.roads).flatMap((road) =>
      flatVertexPath(record(road)?.vertexes),
    ),
  );
  const guides = array(section.guides);
  const steps = guides.map((guide, index) => {
    const current = record(guide) ?? {};
    const next = record(guides[index + 1]);
    return {
      distanceMeters: numberOrNull(current.distance),
      durationSeconds: numberOrNull(current.duration),
      startLocation: xyCoordinate(current.x, current.y) ?? path.at(0) ?? null,
      endLocation: xyCoordinate(next?.x, next?.y) ?? path.at(-1) ?? null,
      travelMode: 'DRIVING',
      instruction: stringOrNull(current.guidance),
      transitDetails: null,
    } satisfies KakaoNormalizedRouteStep;
  });

  return {
    distanceMeters: numberOrNull(section.distance),
    durationSeconds: numberOrNull(section.duration),
    startLocation: path.at(0) ?? steps.at(0)?.startLocation ?? null,
    endLocation: path.at(-1) ?? steps.at(-1)?.endLocation ?? null,
    steps,
  };
}

function parseTransitRoute(value: unknown): KakaoNormalizedRoute {
  const route = record(value) ?? {};
  const properties = record(route.properties) ?? {};
  const stepsAndPaths = array(route.steps).map((step) => {
    const stepProperties = record(record(step)?.properties);
    return parseMapStep(step, stringOrNull(stepProperties?.type) ?? 'TRANSIT');
  });
  const steps = stepsAndPaths.map(({ step }) => step);
  const path = dedupePath(stepsAndPaths.flatMap((item) => item.path));
  const type = stringOrNull(properties.type);
  const leg: KakaoNormalizedRouteLeg = {
    distanceMeters: numberOrNull(properties.totalDistance),
    durationSeconds: numberOrNull(properties.totalTime),
    startLocation: path.at(0) ?? steps.at(0)?.startLocation ?? null,
    endLocation: path.at(-1) ?? steps.at(-1)?.endLocation ?? null,
    steps,
  };
  return {
    description: type ? `Kakao Transit ${type}` : 'Kakao Transit route',
    routeLabels: type ? [type] : [],
    distanceMeters: numberOrNull(properties.totalDistance),
    durationSeconds: numberOrNull(properties.totalTime),
    encodedPolyline: '',
    path,
    bounds: boundsFromPath(path),
    legs: [leg],
    warnings: [],
  };
}

function parsePedestrianRoute(
  value: unknown,
  mode: 'WALKING' | 'BICYCLING',
): KakaoNormalizedRoute {
  const route = record(value) ?? {};
  const properties = record(route.properties) ?? {};
  const legs = array(route.legs).map((leg) => parseMapLeg(leg, mode));
  const path = dedupePath(
    array(route.legs).flatMap((leg) =>
      array(record(leg)?.steps).flatMap((step) => parsePointPath(step)),
    ),
  );
  return {
    description:
      mode === 'WALKING' ? 'Kakao walking route' : 'Kakao bicycle route',
    routeLabels: [],
    distanceMeters: numberOrNull(properties.totalDistance),
    durationSeconds: numberOrNull(properties.totalTime),
    encodedPolyline: '',
    path,
    bounds: boundsFromPath(path),
    legs,
    warnings: [],
  };
}

function parseMapLeg(
  value: unknown,
  mode: 'WALKING' | 'BICYCLING',
): KakaoNormalizedRouteLeg {
  const leg = record(value) ?? {};
  const properties = record(leg.properties) ?? {};
  const stepsAndPaths = array(leg.steps).map((step) =>
    parseMapStep(step, mode),
  );
  const steps = stepsAndPaths.map((item) => item.step);
  const path = dedupePath(stepsAndPaths.flatMap((item) => item.path));
  return {
    distanceMeters: numberOrNull(properties.distance),
    durationSeconds: numberOrNull(properties.time),
    startLocation: path.at(0) ?? steps.at(0)?.startLocation ?? null,
    endLocation: path.at(-1) ?? steps.at(-1)?.endLocation ?? null,
    steps,
  };
}

function parseMapStep(value: unknown, mode: string) {
  const step = record(value) ?? {};
  const properties = record(step.properties) ?? {};
  const path = parsePointPath(step);
  const startLocation =
    xyCoordinate(properties.x, properties.y) ?? path.at(0) ?? null;
  return {
    path,
    step: {
      distanceMeters: numberOrNull(properties.distance),
      durationSeconds: numberOrNull(properties.time),
      startLocation,
      endLocation: path.at(-1) ?? startLocation,
      travelMode: mode,
      instruction: stringOrNull(properties.guidance),
      transitDetails:
        mode === 'BUS' || mode === 'SUBWAY'
          ? {
              stops: array(properties.stops),
              vehicles: array(properties.vehicles),
            }
          : null,
    } satisfies KakaoNormalizedRouteStep,
  };
}

function parsePointPath(value: unknown): KakaoRouteCoordinate[] {
  const path = record(record(value)?.path);
  return array(path?.points).flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const coordinate = xyCoordinate(point[0], point[1]);
    return coordinate ? [coordinate] : [];
  });
}

function flatVertexPath(value: unknown): KakaoRouteCoordinate[] {
  if (!Array.isArray(value)) return [];
  const path: KakaoRouteCoordinate[] = [];
  for (let index = 0; index + 1 < value.length; index += 2) {
    const coordinate = xyCoordinate(value[index], value[index + 1]);
    if (coordinate) path.push(coordinate);
  }
  return path;
}

function boundsFromPath(path: KakaoRouteCoordinate[]): KakaoRouteBounds | null {
  if (!path.length) return null;
  return path.reduce<KakaoRouteBounds>(
    (bounds, point) => ({
      north: Math.max(bounds.north, point.lat),
      south: Math.min(bounds.south, point.lat),
      east: Math.max(bounds.east, point.lng),
      west: Math.min(bounds.west, point.lng),
    }),
    {
      north: path[0]!.lat,
      south: path[0]!.lat,
      east: path[0]!.lng,
      west: path[0]!.lng,
    },
  );
}

function dedupePath(path: KakaoRouteCoordinate[]) {
  return path.filter((point, index) => {
    const previous = path[index - 1];
    return (
      !previous || previous.lat !== point.lat || previous.lng !== point.lng
    );
  });
}

function xyCoordinate(x: unknown, y: unknown): KakaoRouteCoordinate | null {
  const lng = numberOrNull(x);
  const lat = numberOrNull(y);
  return lng === null || lat === null ? null : { lat, lng };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
