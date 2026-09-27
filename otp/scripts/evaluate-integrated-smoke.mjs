import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function evaluateSmokeResponse(route, response) {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    return failure(route, 'OTP_BUILD_ERROR', 'GraphQL returned errors', {
      graphqlErrors: response.errors,
    });
  }
  const connection = response?.data?.planConnection;
  if (!connection || !Array.isArray(connection.edges)) {
    return failure(route, 'OTP_BUILD_ERROR', 'Missing planConnection edges');
  }
  if (connection.edges.length === 0) {
    const routingErrors = connection.routingErrors ?? [];
    const category = classifyNoItinerary(routingErrors);
    return failure(route, category, 'No itinerary returned', { routingErrors });
  }

  const candidates = connection.edges.map((edge, index) =>
    evaluateItinerary(route, edge?.node, index),
  );
  const selected = candidates.find((candidate) => candidate.matchesExpectation);
  if (!selected) {
    const category =
      route.category === 'JR_TOEI_TRANSFER'
        ? 'TRANSFER_ERROR'
        : route.category === 'JR_ONLY'
          ? 'STATION_MAPPING_ERROR'
          : 'ROUTING_QUALITY_ERROR';
    return failure(
      route,
      category,
      'Itineraries exist, but none satisfies the expected feed composition',
      { candidates },
    );
  }
  if (!selected.temporalOrderValid || !selected.stopSequenceValid) {
    return failure(
      route,
      'GTFS_DATA_ERROR',
      'Selected itinerary contains invalid time or stop ordering',
      { selected },
    );
  }

  return {
    id: route.id,
    category: route.category,
    status: 'PASS',
    failureCategory: null,
    message: 'Expected transit composition found',
    itineraryCount: connection.edges.length,
    ...selected,
  };
}

function evaluateItinerary(route, itinerary, index) {
  const legs = Array.isArray(itinerary?.legs) ? itinerary.legs : [];
  const transitLegs = legs.filter(
    (leg) => leg?.transitLeg === true || leg?.mode !== 'WALK',
  );
  const feeds = [
    ...new Set(
      transitLegs.map((leg) => feedId(leg?.agency?.gtfsId)).filter(Boolean),
    ),
  ].sort();
  const agencies = [
    ...new Set(
      transitLegs.map((leg) => leg?.agency?.name).filter(nonEmptyString),
    ),
  ].sort();
  const requiredFeeds = route.requiredFeeds ?? [];
  const allowedFeeds = route.allowedFeeds;
  const containsRequired = requiredFeeds.every((feed) => feeds.includes(feed));
  const containsOnlyAllowed =
    !allowedFeeds || feeds.every((feed) => allowedFeeds.includes(feed));
  const transferRequirement =
    route.category !== 'JR_TOEI_TRANSFER' ||
    Number(itinerary?.numberOfTransfers ?? 0) >= 1;
  const temporalOrderValid =
    positiveDuration(itinerary) &&
    ordered(itinerary?.start, itinerary?.end) &&
    legs.every((leg) =>
      ordered(leg?.start?.scheduledTime, leg?.end?.scheduledTime),
    ) &&
    legs.every((leg, legIndex) => {
      if (legIndex === 0) return true;
      return orderedOrEqual(
        legs[legIndex - 1]?.end?.scheduledTime,
        leg?.start?.scheduledTime,
      );
    });
  const stopSequenceValid =
    transitLegs.length > 0 &&
    transitLegs.every(
      (leg) =>
        nonEmptyString(leg?.from?.stop?.gtfsId) &&
        nonEmptyString(leg?.to?.stop?.gtfsId) &&
        leg.from.stop.gtfsId !== leg.to.stop.gtfsId,
    );
  const operatorIdentifiable =
    agencies.length > 0 &&
    transitLegs.every(
      (leg) =>
        nonEmptyString(leg?.agency?.name) &&
        nonEmptyString(leg?.agency?.gtfsId),
    );
  return {
    selectedItineraryIndex: index,
    durationSeconds: Number(itinerary?.duration ?? 0),
    transfers: Number(itinerary?.numberOfTransfers ?? 0),
    feeds,
    agencies,
    transitLegCount: transitLegs.length,
    temporalOrderValid,
    stopSequenceValid,
    operatorIdentifiable,
    matchesExpectation:
      containsRequired &&
      containsOnlyAllowed &&
      transferRequirement &&
      temporalOrderValid &&
      stopSequenceValid &&
      operatorIdentifiable,
    legs: legs.map((leg) => ({
      mode: leg?.mode ?? null,
      transitLeg: leg?.transitLeg ?? false,
      feedId: feedId(leg?.agency?.gtfsId) ?? null,
      agency: leg?.agency?.name ?? null,
      route: leg?.route?.shortName ?? leg?.route?.longName ?? null,
      from: leg?.from?.name ?? null,
      to: leg?.to?.name ?? null,
      departure: leg?.start?.scheduledTime ?? null,
      arrival: leg?.end?.scheduledTime ?? null,
    })),
  };
}

function failure(route, failureCategory, message, details = {}) {
  return {
    id: route.id,
    category: route.category,
    status: 'FAIL',
    failureCategory,
    message,
    ...details,
  };
}

function feedId(value) {
  if (!nonEmptyString(value)) return undefined;
  const separator = value.indexOf(':');
  return separator === -1 ? value : value.slice(0, separator);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function positiveDuration(itinerary) {
  return Number(itinerary?.duration ?? 0) > 0;
}

function classifyNoItinerary(routingErrors) {
  const codes = routingErrors.map((error) =>
    String(error?.code ?? '').toUpperCase(),
  );
  if (
    codes.some(
      (code) =>
        code.includes('DATE') ||
        code.includes('SERVICE_PERIOD') ||
        code.includes('TRANSIT_NOT_RUNNING'),
    )
  ) {
    return 'SERVICE_DATE_ERROR';
  }
  if (
    codes.some(
      (code) =>
        code.includes('OUTSIDE_BOUNDS') ||
        code.includes('LOCATION_NOT_FOUND') ||
        code.includes('NO_STREET_LOCATION'),
    )
  ) {
    return 'OSM_LINKING_ERROR';
  }
  return 'ROUTING_QUALITY_ERROR';
}

function ordered(start, end) {
  const startTime = Date.parse(String(start ?? ''));
  const endTime = Date.parse(String(end ?? ''));
  return (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime < endTime
  );
}

function orderedOrEqual(start, end) {
  const startTime = Date.parse(String(start ?? ''));
  const endTime = Date.parse(String(end ?? ''));
  return (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime <= endTime
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [routePath, responsePath, outputPath] = process.argv.slice(2);
  if (!routePath || !responsePath || !outputPath) {
    throw new Error(
      'Usage: evaluate-integrated-smoke.mjs ROUTE RESPONSE OUTPUT',
    );
  }
  const [route, response] = await Promise.all([
    readFile(routePath, 'utf8').then(JSON.parse),
    readFile(responsePath, 'utf8').then(JSON.parse),
  ]);
  await writeFile(
    outputPath,
    `${JSON.stringify(evaluateSmokeResponse(route, response), null, 2)}\n`,
    'utf8',
  );
}
