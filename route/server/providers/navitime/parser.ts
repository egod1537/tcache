import { createNavitimeNoRouteError } from './errors.js';
import type {
  NavitimeCoordinate,
  NavitimeNormalizedRoute,
  NavitimeRouteLeg,
  NavitimeRouteResult,
  NavitimeRouteStep,
} from './types.js';

export function parseNavitimeTransitResponse(
  value: unknown,
): NavitimeRouteResult {
  const response = record(value);
  const items = array(response?.items);
  if (!response || !items.length) throw createNavitimeNoRouteError();

  return {
    provider: 'navitime',
    routes: items.map(parseRoute),
    metadata: { upstreamStatus: 'OK' },
  };
}

function parseRoute(value: unknown): NavitimeNormalizedRoute {
  const route = record(value) ?? {};
  const summary = record(route.summary) ?? {};
  const summaryMove = record(summary.move) ?? {};
  const sections = array(route.sections);
  const legs = sections.flatMap((section, index) => {
    const move = record(section);
    if (move?.type !== 'move') return [];
    const start = nearestPoint(sections, index, -1);
    const end = nearestPoint(sections, index, 1);
    return [parseMoveLeg(move, start, end)];
  });
  const shapePath = parseShapes(route.shapes);
  const pointPath = sections.flatMap((section) => {
    const item = record(section);
    const coordinate =
      item?.type === 'point' ? coordinateFrom(item.coord) : null;
    return coordinate ? [coordinate] : [];
  });
  const path = dedupePath(shapePath.length ? shapePath : pointPath);
  const start = record(summary.start);
  const goal = record(summary.goal);
  const transfers = numberOrNull(summaryMove.transit_count);
  const departureTime = stringOrNull(summaryMove.from_time);
  const arrivalTime = stringOrNull(summaryMove.to_time);

  return {
    description: `${stringOrNull(start?.name) ?? 'start'} → ${stringOrNull(goal?.name) ?? 'goal'}`,
    routeLabels:
      transfers === null
        ? []
        : [`${transfers} transfer${transfers === 1 ? '' : 's'}`],
    distanceMeters: numberOrNull(summaryMove.distance),
    durationSeconds: minutesToSeconds(summaryMove.time),
    encodedPolyline: '',
    path,
    bounds: boundsFromPath(path),
    legs,
    warnings: [],
    providerMetadata: {
      departureTime,
      arrivalTime,
      transfers,
      fare: safeRecord(summaryMove.fare),
      referenceFare: safeRecord(summaryMove.reference_fare),
      moveTypes: stringArray(summaryMove.move_types ?? summaryMove.move_type),
    },
  };
}

function parseMoveLeg(
  move: Record<string, unknown>,
  start: Record<string, unknown> | null,
  end: Record<string, unknown> | null,
): NavitimeRouteLeg {
  const startLocation = coordinateFrom(start?.coord);
  const endLocation = coordinateFrom(end?.coord);
  const transport = record(move.transport);
  const rawMove = stringOrNull(move.move) ?? 'unknown';
  const travelMode = rawMove === 'walk' ? 'WALKING' : 'TRANSIT';
  const lineName =
    stringOrNull(transport?.self_name) ??
    stringOrNull(move.line_name) ??
    stringOrNull(transport?.name);
  const providerMetadata = {
    moveType: rawMove,
    lineName,
    departureTime: stringOrNull(move.from_time),
    arrivalTime: stringOrNull(move.to_time),
    transferRequired: move.next_transit === true,
    transferSeconds: numberOrNull(move.transfer_seconds),
    fare: safeRecord(transport?.fare),
    company: safeRecord(transport?.company),
    startStation: pointMetadata(start),
    endStation: pointMetadata(end),
    callingAt: callingAt(transport),
  };
  const step: NavitimeRouteStep = {
    distanceMeters: numberOrNull(move.distance),
    durationSeconds: minutesToSeconds(move.time),
    startLocation,
    endLocation,
    travelMode,
    instruction: lineName ?? (rawMove === 'walk' ? 'Walk' : rawMove),
    transitDetails: providerMetadata,
  };
  return {
    distanceMeters: step.distanceMeters,
    durationSeconds: step.durationSeconds,
    startLocation,
    endLocation,
    steps: [step],
    providerMetadata,
  };
}

function nearestPoint(sections: unknown[], index: number, direction: -1 | 1) {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < sections.length;
    cursor += direction
  ) {
    const item = record(sections[cursor]);
    if (item?.type === 'point') return item;
  }
  return null;
}

function pointMetadata(value: Record<string, unknown> | null) {
  if (!value) return null;
  return {
    id: stringOrNull(value.node_id),
    name: stringOrNull(value.name),
    platform: stringOrNull(value.start_platform ?? value.goal_platform),
  };
}

function callingAt(transport: Record<string, unknown> | null) {
  return array(transport?.calling_at).map((item) => {
    const stop = record(item) ?? {};
    return {
      id: stringOrNull(stop.node_id),
      name: stringOrNull(stop.name),
      arrivalTime: stringOrNull(stop.from_time),
      departureTime: stringOrNull(stop.to_time),
    };
  });
}

function parseShapes(value: unknown): NavitimeCoordinate[] {
  const shapes = record(value);
  return array(shapes?.features).flatMap((feature) => {
    const geometry = record(record(feature)?.geometry);
    if (geometry?.type === 'LineString') {
      return coordinateArray(geometry.coordinates);
    }
    if (geometry?.type === 'MultiLineString') {
      return array(geometry.coordinates).flatMap(coordinateArray);
    }
    return [];
  });
}

function coordinateArray(value: unknown): NavitimeCoordinate[] {
  return array(value).flatMap((item) => {
    if (!Array.isArray(item) || item.length < 2) return [];
    const lng = numberOrNull(item[0]);
    const lat = numberOrNull(item[1]);
    return lat === null || lng === null ? [] : [{ lat, lng }];
  });
}

function coordinateFrom(value: unknown): NavitimeCoordinate | null {
  const coordinate = record(value);
  const lat = numberOrNull(coordinate?.lat);
  const lng = numberOrNull(coordinate?.lon);
  return lat === null || lng === null ? null : { lat, lng };
}

function boundsFromPath(path: NavitimeCoordinate[]) {
  if (!path.length) return null;
  return path.reduce(
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

function dedupePath(path: NavitimeCoordinate[]) {
  return path.filter((point, index) => {
    const previous = path[index - 1];
    return (
      !previous || previous.lat !== point.lat || previous.lng !== point.lng
    );
  });
}

function minutesToSeconds(value: unknown) {
  const minutes = numberOrNull(value);
  return minutes === null ? null : minutes * 60;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return record(value);
}

function stringArray(value: unknown) {
  return array(value).filter(
    (item): item is string => typeof item === 'string',
  );
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
  return typeof value === 'string' && value.trim() ? value : null;
}
