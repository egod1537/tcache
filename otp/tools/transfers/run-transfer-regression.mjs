#!/usr/bin/env node

/* global AbortSignal, fetch */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeStationName, round } from './lib.mjs';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function evaluateTransferResponse(testCase, response, complexMap) {
  if (response?.errors?.length) {
    return failure(testCase, 'OTP_BUILD_ERROR', 'GraphQL returned errors.', {
      graphqlErrors: response.errors,
    });
  }
  const connection = response?.data?.planConnection;
  if (!connection || !Array.isArray(connection.edges)) {
    return failure(
      testCase,
      'OTP_BUILD_ERROR',
      'Missing planConnection edges.',
    );
  }
  const expectedComplex = complexMap.complexes.find(
    (item) => item.stationComplexId === testCase.expectedComplexId,
  );
  if (!expectedComplex) {
    return failure(
      testCase,
      'STATION_MAPPING_ERROR',
      `Unknown expected complex ${testCase.expectedComplexId}.`,
    );
  }
  const candidates = connection.edges.map((edge, index) =>
    evaluateItinerary(testCase, edge?.node, expectedComplex, index),
  );
  const selected = candidates.find((item) => item.matchesExpectation);
  if (!selected) {
    return failure(
      testCase,
      'TRANSFER_ERROR',
      'No itinerary satisfied feed, station-complex, and walking safety assertions.',
      { itineraryCount: candidates.length, candidates },
    );
  }
  return {
    id: testCase.id,
    category: testCase.category,
    status: 'PASS',
    expectedComplexId: testCase.expectedComplexId,
    itineraryCount: candidates.length,
    ...selected,
  };
}

function evaluateItinerary(testCase, itinerary, expectedComplex, index) {
  const legs = Array.isArray(itinerary?.legs) ? itinerary.legs : [];
  const transitLegs = legs
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => leg.transitLeg === true);
  const feeds = transitLegs.map(({ leg }) => feedId(leg.agency?.gtfsId));
  const uniqueFeeds = [...new Set(feeds.filter(Boolean))];
  const transitions = [];
  for (let index = 0; index < transitLegs.length - 1; index += 1) {
    const from = transitLegs[index];
    const to = transitLegs[index + 1];
    const between = legs.slice(from.legIndex + 1, to.legIndex);
    const walkLegs = between.filter((leg) => leg.mode === 'WALK');
    const walkDurationSeconds = walkLegs.reduce(
      (sum, leg) => sum + Number(leg.duration ?? 0),
      0,
    );
    const walkDistanceMeters = walkLegs.reduce(
      (sum, leg) => sum + Number(leg.distance ?? 0),
      0,
    );
    const fromStopId = from.leg.to?.stop?.gtfsId ?? null;
    const toStopId = to.leg.from?.stop?.gtfsId ?? null;
    transitions.push({
      fromFeedId: feedId(from.leg.agency?.gtfsId) ?? null,
      toFeedId: feedId(to.leg.agency?.gtfsId) ?? null,
      fromRouteId: from.leg.route?.gtfsId ?? null,
      toRouteId: to.leg.route?.gtfsId ?? null,
      fromStopId,
      fromStopName: from.leg.to?.name ?? null,
      toStopId,
      toStopName: to.leg.from?.name ?? null,
      walkLegCount: walkLegs.length,
      walkDurationSeconds: round(walkDurationSeconds, 0),
      walkDistanceMeters: round(walkDistanceMeters),
      zeroSecondDifferentStop:
        fromStopId !== toStopId && walkDurationSeconds === 0,
      excessiveInternalWalk: walkDurationSeconds > 900,
    });
  }
  const complexMemberIds = new Set(
    expectedComplex.members.map((member) => member.scopedStopId),
  );
  const expectedTransition = transitions.find(
    (transition) =>
      complexMemberIds.has(transition.fromStopId) &&
      complexMemberIds.has(transition.toStopId),
  );
  const requiredFeeds = testCase.requiredFeeds ?? [];
  const allowedFeeds = testCase.allowedFeeds;
  const feedCompositionValid =
    requiredFeeds.every((feed) => uniqueFeeds.includes(feed)) &&
    (!allowedFeeds || uniqueFeeds.every((feed) => allowedFeeds.includes(feed)));
  const orderValid =
    !testCase.feedOrder ||
    containsOrderedPair(feeds, testCase.feedOrder[0], testCase.feedOrder[1]);
  const transferCount = Number(itinerary?.numberOfTransfers ?? 0);
  const transferCountReasonable =
    transferCount >= (testCase.minTransfers ?? 1) &&
    transferCount <= (testCase.maxTransfers ?? 3);
  const noImpossibleTeleport = transitions.every(
    (transition) => !transition.zeroSecondDifferentStop,
  );
  const noExcessiveInternalWalk = transitions.every(
    (transition) => !transition.excessiveInternalWalk,
  );
  const temporalOrderValid =
    Number(itinerary?.duration ?? 0) > 0 &&
    legs.every((leg) =>
      ordered(leg.start?.scheduledTime, leg.end?.scheduledTime),
    );
  const requiredStopIds = testCase.mustUseGtfsStopIds ?? [];
  const usedTransitStopIds = new Set(
    transitLegs.flatMap(({ leg }) => [
      leg.from?.stop?.gtfsId,
      leg.to?.stop?.gtfsId,
    ]),
  );
  const exactStopAssertion = requiredStopIds.every((id) =>
    usedTransitStopIds.has(id),
  );
  return {
    selectedItineraryIndex: index,
    durationSeconds: Number(itinerary?.duration ?? 0),
    transferCount,
    feeds: uniqueFeeds,
    feedCompositionValid,
    feedOrderValid: orderValid,
    transferCountReasonable,
    expectedTransferObserved: Boolean(expectedTransition),
    noImpossibleTeleport,
    noExcessiveInternalWalk,
    temporalOrderValid,
    exactStopAssertion,
    expectedTransition: expectedTransition ?? null,
    transitions,
    matchesExpectation:
      feedCompositionValid &&
      orderValid &&
      transferCountReasonable &&
      Boolean(expectedTransition) &&
      noImpossibleTeleport &&
      noExcessiveInternalWalk &&
      temporalOrderValid &&
      exactStopAssertion,
    legs: legs.map((leg) => ({
      mode: leg.mode ?? null,
      transitLeg: leg.transitLeg ?? false,
      durationSeconds: Number(leg.duration ?? 0),
      distanceMeters: round(Number(leg.distance ?? 0)),
      feedId: feedId(leg.agency?.gtfsId) ?? null,
      routeId: leg.route?.gtfsId ?? null,
      route: leg.route?.shortName ?? leg.route?.longName ?? null,
      from: leg.from?.name ?? null,
      fromStopId: leg.from?.stop?.gtfsId ?? null,
      to: leg.to?.name ?? null,
      toStopId: leg.to?.stop?.gtfsId ?? null,
    })),
  };
}

function containsOrderedPair(values, from, to) {
  const fromIndex = values.indexOf(from);
  return fromIndex !== -1 && values.slice(fromIndex + 1).includes(to);
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

function feedId(value) {
  if (!value) return undefined;
  const parts = String(value).split(':');
  return parts[0];
}

function failure(testCase, failureCategory, message, details = {}) {
  return {
    id: testCase.id,
    category: testCase.category,
    expectedComplexId: testCase.expectedComplexId,
    status: 'FAIL',
    failureCategory,
    message,
    ...details,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const outputDir = `${buildRoot}/diagnostics/transfers/regression`;
  const [suite, query, complexMap] = await Promise.all([
    readFile(resolveRepositoryPath(options.cases), 'utf8').then(JSON.parse),
    readFile(resolveRepositoryPath(options.query), 'utf8'),
    readFile(
      `${buildRoot}/diagnostics/transfers/station-complex-map.json`,
      'utf8',
    ).then(JSON.parse),
  ]);
  await mkdir(`${outputDir}/responses`, { recursive: true });
  const results = [];
  for (const [index, testCase] of suite.cases.entries()) {
    const request = createRequest(testCase, suite, query);
    const httpResponse = await fetch(`${options.baseUrl}/otp/gtfs/v1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en',
        OTPTimeout: '180000',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(190_000),
    });
    const response = await httpResponse.json();
    const result = evaluateTransferResponse(testCase, response, complexMap);
    const prefix = `${String(index + 1).padStart(2, '0')}-${safeId(testCase.id)}`;
    await Promise.all([
      writeFile(
        `${outputDir}/responses/${prefix}.request.json`,
        `${JSON.stringify(request, null, 2)}\n`,
      ),
      writeFile(
        `${outputDir}/responses/${prefix}.response.json`,
        `${JSON.stringify(response, null, 2)}\n`,
      ),
    ]);
    results.push(result);
    process.stdout.write(`${testCase.id}: ${result.status}\n`);
  }
  const passingTransitions = results
    .filter((result) => result.status === 'PASS')
    .map((result) => result.expectedTransition);
  const summary = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    departureTime: suite.departureTime,
    status:
      results.length >= 20 &&
      results.every((result) => result.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
    passed: results.filter((result) => result.status === 'PASS').length,
    failed: results.filter((result) => result.status === 'FAIL').length,
    metrics: {
      testedCases: results.length,
      verifiedStationComplexes: new Set(
        results
          .filter((result) => result.status === 'PASS')
          .map((result) => result.expectedComplexId),
      ).size,
      averageTransferWalkingTimeSeconds: round(
        passingTransitions.reduce(
          (sum, transition) => sum + transition.walkDurationSeconds,
          0,
        ) / Math.max(1, passingTransitions.length),
        1,
      ),
      abnormalZeroSecondTransfers: passingTransitions.filter(
        (transition) => transition.zeroSecondDifferentStop,
      ).length,
      stationInternalTransfersOver15Minutes: passingTransitions.filter(
        (transition) => transition.excessiveInternalWalk,
      ).length,
    },
    categoryCounts: Object.fromEntries(
      [...new Set(results.map((result) => result.category))].map((category) => [
        category,
        {
          passed: results.filter(
            (result) =>
              result.category === category && result.status === 'PASS',
          ).length,
          total: results.filter((result) => result.category === category)
            .length,
        },
      ]),
    ),
    results,
  };
  await writeFile(
    `${outputDir}/transfer-regression-cases.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    `${buildRoot}/diagnostics/transfers/transfer-regression-cases.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ outputDir, status: summary.status, passed: summary.passed, failed: summary.failed, metrics: summary.metrics }, null, 2)}\n`,
  );
  if (summary.status !== 'PASS') process.exitCode = 1;
}

function createRequest(testCase, suite, query) {
  return {
    operationName: 'PlanTokyo',
    query,
    variables: {
      origin: {
        label: testCase.origin.name,
        location: {
          coordinate: {
            latitude: testCase.origin.latitude,
            longitude: testCase.origin.longitude,
          },
        },
      },
      destination: {
        label: testCase.destination.name,
        location: {
          coordinate: {
            latitude: testCase.destination.latitude,
            longitude: testCase.destination.longitude,
          },
        },
      },
      dateTime: { earliestDeparture: suite.departureTime },
      first: suite.itineraryCount ?? 20,
    },
  };
}

function safeId(value) {
  return normalizeStationName(value).replaceAll(
    /[^a-z0-9가-힣ぁ-んァ-ヶ一-龠]+/giu,
    '-',
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    baseUrl: 'http://localhost:8080',
    cases: 'otp/config/transfer-regression-suite.json',
    query: 'otp/queries/plan-tokyo.graphql',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] =
      args[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
