import { createEkispertResponseError } from './errors.js';
import type {
  EkispertCoordinate,
  EkispertNormalizedRoute,
  EkispertRouteLeg,
  EkispertRouteResult,
  EkispertRouteStep,
} from './types.js';

export function parseEkispertTransitResponse(
  value: unknown,
): EkispertRouteResult {
  const resultSet = record(record(value)?.ResultSet);
  if (!resultSet) {
    throw createEkispertResponseError('MALFORMED_RESPONSE');
  }
  const upstreamError = record(resultSet.Error);
  if (upstreamError) {
    throw createEkispertResponseError(
      text(upstreamError.code) ?? 'UPSTREAM_ERROR',
      text(upstreamError.Message),
    );
  }
  const courses = values(resultSet.Course);
  if (!courses.length) {
    throw createEkispertResponseError('NO_ROUTE', 'No route found');
  }

  return {
    provider: 'ekispert',
    routes: courses.map(parseCourse),
    metadata: {
      upstreamStatus: 'OK',
      apiVersion: text(resultSet.apiVersion),
      engineVersion: text(resultSet.engineVersion),
    },
  };
}

function parseCourse(value: unknown): EkispertNormalizedRoute {
  const course = record(value);
  const route = record(course?.Route);
  if (!course || !route) {
    throw createEkispertResponseError('MALFORMED_RESPONSE');
  }
  const points = values(route.Point).map((item) => record(item) ?? {});
  const lines = values(route.Line).map((item) => record(item) ?? {});
  if (points.length < 2 || lines.length !== points.length - 1) {
    throw createEkispertResponseError('MALFORMED_RESPONSE');
  }

  const path = points.flatMap((point) => {
    const coordinate = pointCoordinate(point);
    return coordinate ? [coordinate] : [];
  });
  const legs = lines.map((line, index) =>
    parseLine(line, points[index]!, points[index + 1]!),
  );
  const transferCount = integer(route.transferCount);
  const origin = pointName(points[0]!) ?? 'origin';
  const destination = pointName(points.at(-1)!) ?? 'destination';
  const fare = parseFare(course.Price);
  const departureTime = lineDateTime(lines[0]?.DepartureState);
  const arrivalTime = lineDateTime(lines.at(-1)?.ArrivalState);
  const totalMinutes = sumNumbers(
    route.timeOnBoard,
    route.timeWalk,
    route.timeOther,
  );

  return {
    description: `${origin} → ${destination}`,
    routeLabels:
      transferCount === null
        ? []
        : [`${transferCount} transfer${transferCount === 1 ? '' : 's'}`],
    distanceMeters: hundredMeters(route.distance),
    durationSeconds: totalMinutes === null ? null : totalMinutes * 60,
    encodedPolyline: '',
    path,
    bounds: boundsFromPath(path),
    legs,
    warnings: [],
    departureTime,
    arrivalTime,
    transferCount,
    fare,
    providerMetadata: {
      departureTime,
      arrivalTime,
      transferCount,
      fare,
      searchType: text(course.searchType),
      dataType: text(course.dataType),
    },
  };
}

function parseLine(
  line: Record<string, unknown>,
  start: Record<string, unknown>,
  end: Record<string, unknown>,
): EkispertRouteLeg {
  const startLocation = pointCoordinate(start);
  const endLocation = pointCoordinate(end);
  const lineType = text(line.Type);
  const lineName = text(line.Name) ?? text(line.TypicalName);
  const walking =
    lineType?.toLowerCase() === 'walk' ||
    lineType === '徒歩' ||
    lineName?.includes('徒歩') === true;
  const departureTime = lineDateTime(line.DepartureState);
  const arrivalTime = lineDateTime(line.ArrivalState);
  const departureState = record(line.DepartureState);
  const arrivalState = record(line.ArrivalState);
  const transitDetails = {
    lineName,
    operatorName: text(record(line.Corporation)?.Name),
    destination: text(line.Destination),
    lineType,
    departureStop: stop(start, departureState),
    arrivalStop: stop(end, arrivalState),
    departureTime,
    arrivalTime,
    numberOfStops: integer(line.stopStationCount),
    vehicleNumber: text(line.Number),
    callingAt: values(line.Stop).map((value) => {
      const lineStop = record(value) ?? {};
      const point = record(lineStop.Point) ?? {};
      return {
        ...stop(point, null),
        arrivalTime: lineDateTime(lineStop.ArrivalState),
        departureTime: lineDateTime(lineStop.DepartureState),
      };
    }),
  };
  const step: EkispertRouteStep = {
    distanceMeters: hundredMeters(line.distance),
    durationSeconds: minutesToSeconds(line.timeOnBoard),
    startLocation,
    endLocation,
    travelMode: walking ? 'WALKING' : 'TRANSIT',
    instruction: lineName ?? (walking ? 'Walk' : lineType),
    transitDetails: walking ? null : transitDetails,
  };
  return {
    distanceMeters: step.distanceMeters,
    durationSeconds: step.durationSeconds,
    startLocation,
    endLocation,
    steps: [step],
    providerMetadata: {
      ...transitDetails,
      mode: step.travelMode,
    },
  };
}

function stop(
  point: Record<string, unknown>,
  state: Record<string, unknown> | null,
) {
  const station = record(point.Station);
  return {
    id: text(station?.code),
    name: pointName(point),
    platform: text(state?.no),
    location: pointCoordinate(point),
  };
}

function parseFare(value: unknown) {
  const prices = values(value).map((item) => record(item) ?? {});
  const selected =
    prices.find((price) => text(price.kind) === 'FareSummary') ??
    prices.find((price) => text(price.selected)?.toLowerCase() === 'true');
  const amount = number(selected?.Oneway);
  return amount === null ? null : { amount, currency: 'JPY' as const };
}

function lineDateTime(value: unknown) {
  return text(record(value)?.Datetime);
}

function pointName(point: Record<string, unknown>) {
  return text(record(point.Station)?.Name) ?? text(point.Name);
}

function pointCoordinate(
  point: Record<string, unknown>,
): EkispertCoordinate | null {
  const geo = record(point.GeoPoint);
  const lat = number(geo?.lati_d);
  const lng = number(geo?.longi_d);
  return lat === null || lng === null ? null : { lat, lng };
}

function boundsFromPath(path: EkispertCoordinate[]) {
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

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    return normalized || null;
  }
  const object = record(value);
  return object ? text(object.text) : null;
}

function number(value: unknown): number | null {
  const normalized = typeof value === 'number' ? value : text(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function hundredMeters(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : parsed * 100;
}

function minutesToSeconds(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : parsed * 60;
}

function sumNumbers(...valuesToSum: unknown[]) {
  const parsed = valuesToSum.map(number);
  return parsed.every((value) => value === null)
    ? null
    : parsed.reduce<number>((total, value) => total + (value ?? 0), 0);
}
