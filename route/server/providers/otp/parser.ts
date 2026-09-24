import {
  boundsFromPath,
  decodeGooglePolyline,
  encodeGooglePolyline,
} from '../google/polyline.js';
import {
  createOtpGraphqlError,
  createOtpInvalidDataError,
  createOtpNoRouteError,
  createOtpRoutingError,
} from './errors.js';
import type {
  OtpCoordinate,
  OtpDatasetIdentity,
  OtpNormalizedRouteResult,
} from './types.js';

export function parseOtpTransitResponse(
  value: unknown,
  datasetIdentity: OtpDatasetIdentity = {},
): OtpNormalizedRouteResult {
  const graphqlErrors = record(value)?.errors;
  if (Array.isArray(graphqlErrors) && graphqlErrors.length) {
    throw createOtpGraphqlError(value);
  }
  const connection = record(record(value)?.data)?.planConnection;
  const plan = record(connection);
  if (!plan || !Array.isArray(plan.edges)) {
    throw createOtpInvalidDataError(
      'Response does not contain data.planConnection.edges',
    );
  }
  const routingErrors = plan.routingErrors;
  if (Array.isArray(routingErrors) && routingErrors.length) {
    const first = record(routingErrors[0]) ?? {};
    throw createOtpRoutingError(
      text(first.code) ?? 'ROUTING_ERROR',
      text(first.description),
    );
  }
  if (!plan.edges.length) throw createOtpNoRouteError();

  const routes = plan.edges.map((edge) => parseItinerary(record(edge)?.node));
  return {
    provider: 'otp',
    routes,
    metadata: {
      upstreamStatus: 'OK',
      itineraryCount: routes.length,
      selectionPolicy: 'all-returned-in-upstream-order',
      searchDateTime: text(plan.searchDateTime),
      datasetIdentity,
    },
  };
}

function parseItinerary(value: unknown) {
  const itinerary = record(value);
  if (!itinerary || !Array.isArray(itinerary.legs) || !itinerary.legs.length) {
    throw createOtpInvalidDataError('Itinerary does not contain legs');
  }
  const legs = itinerary.legs.map(parseLeg);
  const path = appendPaths(
    itinerary.legs.map((leg) => geometry(record(leg)?.legGeometry)),
  );
  const lineNames = unique(
    itinerary.legs.flatMap((leg) => {
      const route = record(record(leg)?.route);
      const name = text(route?.shortName) ?? text(route?.longName);
      return name ? [name] : [];
    }),
  );
  const origin =
    text(record(record(itinerary.legs[0])?.from)?.name) ?? 'origin';
  const destination =
    text(record(record(itinerary.legs.at(-1))?.to)?.name) ?? 'destination';
  const encodedPolyline = path.length ? encodeGooglePolyline(path) : '';
  const walkTime = number(itinerary.walkTime);
  const duration = number(itinerary.duration);
  const transitDuration = itinerary.legs.reduce(
    (total, leg) =>
      total +
      (record(leg)?.transitLeg === true
        ? (number(record(leg)?.duration) ?? 0)
        : 0),
    0,
  );

  return {
    description: `${origin} → ${destination}`,
    routeLabels: lineNames,
    distanceMeters: sum(
      itinerary.legs.map((leg) => number(record(leg)?.distance)),
    ),
    durationSeconds: duration,
    encodedPolyline,
    path,
    bounds: boundsFromPath(path),
    legs,
    warnings: [],
    departureTime: text(itinerary.start),
    arrivalTime: text(itinerary.end),
    transferCount: integer(itinerary.numberOfTransfers),
    providerMetadata: {
      walkingDurationSeconds: walkTime,
      walkingDistanceMeters: number(itinerary.walkDistance),
      transitDurationSeconds: transitDuration,
      otpModes: unique(
        itinerary.legs.flatMap((leg) => {
          const mode = text(record(leg)?.mode);
          return mode ? [mode] : [];
        }),
      ),
    },
  };
}

function parseLeg(value: unknown) {
  const leg = record(value);
  if (!leg) throw createOtpInvalidDataError('Leg must be an object');
  const startLocation = coordinate(leg.from);
  const endLocation = coordinate(leg.to);
  const route = record(leg.route);
  const agency = record(leg.agency);
  const transit = leg.transitLeg === true;
  const lineName = text(route?.shortName) ?? text(route?.longName);
  const departureTime = text(record(leg.start)?.scheduledTime);
  const arrivalTime = text(record(leg.end)?.scheduledTime);
  const transitDetails = transit
    ? {
        lineName,
        operatorName: text(agency?.name),
        departureStop: stop(leg.from),
        arrivalStop: stop(leg.to),
        departureTime,
        arrivalTime,
        headsign: text(leg.headsign),
      }
    : null;
  const distanceMeters = number(leg.distance);
  const durationSeconds = number(leg.duration);
  const step = {
    distanceMeters,
    durationSeconds,
    startLocation,
    endLocation,
    travelMode: transit ? ('TRANSIT' as const) : ('WALKING' as const),
    instruction: transit
      ? (lineName ?? text(leg.mode))
      : `Walk to ${text(record(leg.to)?.name) ?? 'destination'}`,
    transitDetails,
  };
  return {
    distanceMeters,
    durationSeconds,
    startLocation,
    endLocation,
    steps: [step],
    providerMetadata: {
      otpMode: text(leg.mode),
      transitLeg: transit,
      departureTime,
      arrivalTime,
      routeId: text(route?.gtfsId),
      agencyId: text(agency?.gtfsId),
      geometryLength: integer(record(leg.legGeometry)?.length),
    },
  };
}

function stop(value: unknown) {
  const place = record(value);
  const stopValue = record(place?.stop);
  return {
    id: text(stopValue?.gtfsId),
    name: text(stopValue?.name) ?? text(place?.name),
    platform: text(stopValue?.platformCode),
    location: coordinate(place),
  };
}

function coordinate(value: unknown): OtpCoordinate | null {
  const point = record(value);
  const lat = number(point?.lat);
  const lng = number(point?.lon);
  return lat === null || lng === null ? null : { lat, lng };
}

function geometry(value: unknown): OtpCoordinate[] {
  const points = text(record(value)?.points);
  if (!points) return [];
  try {
    return decodeGooglePolyline(points);
  } catch {
    throw createOtpInvalidDataError('OTP leg geometry is malformed');
  }
}

function appendPaths(paths: OtpCoordinate[][]) {
  const result: OtpCoordinate[] = [];
  for (const path of paths) {
    for (const point of path) {
      const previous = result.at(-1);
      if (
        !previous ||
        previous.lat !== point.lat ||
        previous.lng !== point.lng
      ) {
        result.push(point);
      }
    }
  }
  return result;
}

function sum(values: Array<number | null>) {
  return values.every((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
