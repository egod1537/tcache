#!/usr/bin/env node

/* global AbortSignal, fetch */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { round } from './lib.mjs';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function evaluateWalkResponse(response) {
  const itineraries = response?.data?.planConnection?.edges ?? [];
  const itinerary = itineraries
    .map((edge) => edge.node)
    .find((node) => {
      const legs = node?.legs ?? [];
      return (
        Number(node?.duration) > 0 &&
        Number(node?.duration) <= 900 &&
        Number(node?.walkDistance) > 0 &&
        legs.length > 0 &&
        legs.every((leg) => leg.mode === 'WALK')
      );
    });
  return {
    status: itinerary ? 'PASS' : 'FAIL',
    durationSeconds: itinerary ? Number(itinerary.duration) : null,
    distanceMeters: itinerary ? round(Number(itinerary.walkDistance)) : null,
    routingErrors: response?.data?.planConnection?.routingErrors ?? [],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const outputDir = `${buildRoot}/diagnostics/transfers/walk-validation`;
  const [map, query] = await Promise.all([
    readFile(
      `${buildRoot}/diagnostics/transfers/station-complex-map.json`,
      'utf8',
    ).then(JSON.parse),
    readFile(resolveRepositoryPath(options.query), 'utf8'),
  ]);
  await mkdir(`${outputDir}/responses`, { recursive: true });
  const results = [];
  for (const complex of map.complexes) {
    const pairs = validationPairs(complex);
    for (const [pairIndex, [from, to]] of pairs.entries()) {
      const request = {
        operationName: 'WalkStationComplex',
        query,
        variables: {
          origin: location(from),
          destination: location(to),
          dateTime: { earliestDeparture: options.departureTime },
          first: 3,
        },
      };
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
      const evaluation = evaluateWalkResponse(response);
      const id = `${safeId(complex.stationComplexId)}-${pairIndex + 1}`;
      await writeFile(
        `${outputDir}/responses/${id}.json`,
        `${JSON.stringify({ request, response }, null, 2)}\n`,
      );
      results.push({
        id,
        stationComplexId: complex.stationComplexId,
        from: memberSummary(from),
        to: memberSummary(to),
        ...evaluation,
      });
      process.stdout.write(`${id}: ${evaluation.status}\n`);
    }
  }
  const passed = results.filter((item) => item.status === 'PASS');
  const targetedNippori = results.find(
    (item) =>
      item.stationComplexId === 'tokyo:nippori' &&
      new Set([item.from.scopedStopId, item.to.scopedStopId]).has(
        'jp-tokyo-toei-bus:1178-03',
      ),
  );
  const summary = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status:
      results.length > 0 && passed.length === results.length ? 'PASS' : 'FAIL',
    passed: passed.length,
    failed: results.length - passed.length,
    metrics: {
      validatedPairs: results.length,
      validatedComplexes: new Set(passed.map((item) => item.stationComplexId))
        .size,
      averageWalkingTimeSeconds: round(
        passed.reduce((sum, item) => sum + item.durationSeconds, 0) /
          Math.max(1, passed.length),
        1,
      ),
      abnormalZeroSecondPaths: passed.filter(
        (item) => item.durationSeconds === 0,
      ).length,
      pathsOver15Minutes: results.filter((item) => item.durationSeconds > 900)
        .length,
    },
    targetedFindings: {
      nippori1178_03: targetedNippori ?? null,
    },
    results,
  };
  const outputPath = `${buildRoot}/diagnostics/transfers/complex-walk-validation.json`;
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ outputPath, status: summary.status, passed: summary.passed, failed: summary.failed, metrics: summary.metrics }, null, 2)}\n`,
  );
  if (summary.status !== 'PASS') process.exitCode = 1;
}

function validationPairs(complex) {
  const byScopedId = new Map(
    complex.members.map((member) => [member.scopedStopId, member]),
  );
  const requestedIds = complex.walkPathReview?.validationMemberIds;
  if (requestedIds?.length === 2) {
    const requested = requestedIds.map((id) => byScopedId.get(id));
    if (requested.every(Boolean)) return [requested];
    throw new Error(
      `${complex.stationComplexId}: unknown validationMemberIds.`,
    );
  }
  const byFeed = new Map();
  for (const member of complex.members) {
    const items = byFeed.get(member.feedId) ?? [];
    items.push(member);
    byFeed.set(member.feedId, items);
  }
  const anchors = [...byFeed.values()].map(
    (members) =>
      members.find((member) => member.locationType === 1) ?? members[0],
  );
  if (anchors.length > 1) {
    const pairs = [];
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        pairs.push([anchors[left], anchors[right]]);
      }
    }
    return pairs;
  }
  const transitMembers = complex.members.filter(
    (member) => member.mode !== 'BUS',
  );
  return transitMembers.length >= 2
    ? [[transitMembers[0], transitMembers[1]]]
    : [];
}

function location(member) {
  return {
    label: `${member.stopName} ${member.scopedStopId}`,
    location: {
      coordinate: { latitude: member.lat, longitude: member.lon },
    },
  };
}

function memberSummary(member) {
  return {
    scopedStopId: member.scopedStopId,
    stopName: member.stopName,
    lat: member.lat,
    lon: member.lon,
  };
}

function safeId(value) {
  return value.replaceAll(/[^a-z0-9]+/giu, '-');
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    baseUrl: 'http://localhost:8080',
    query: 'otp/queries/walk-station-complex.graphql',
    departureTime: '2026-09-29T10:00:00+09:00',
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
