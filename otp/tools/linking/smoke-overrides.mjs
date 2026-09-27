#!/usr/bin/env node

/* global AbortSignal, fetch */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEPARTURE_TIME = '2026-09-29T10:00:00+09:00';

export function evaluateStopResponse(response, expectedGtfsStopId) {
  const routingErrors = response.data?.planConnection?.routingErrors ?? [];
  const itineraries = (response.data?.planConnection?.edges ?? []).map(
    (edge) => edge.node,
  );
  const matching = itineraries.find((itinerary) => {
    if (!(itinerary.duration > 0) || !Array.isArray(itinerary.legs))
      return false;
    return itinerary.legs.some(
      (leg) =>
        leg.transitLeg === true &&
        leg.from?.stop?.gtfsId === expectedGtfsStopId &&
        new Date(leg.start?.scheduledTime).getTime() <
          new Date(leg.end?.scheduledTime).getTime(),
    );
  });
  return {
    status: matching ? 'PASS' : 'FAIL',
    itineraryCount: itineraries.length,
    matchingBoardingCount: itineraries.filter((itinerary) =>
      itinerary.legs?.some(
        (leg) =>
          leg.transitLeg === true &&
          leg.from?.stop?.gtfsId === expectedGtfsStopId,
      ),
    ).length,
    routingErrors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolve(options.buildRoot);
  const outputDir = `${buildRoot}/diagnostics/linking/override-stop-smoke`;
  const [overrides, query] = await Promise.all([
    readFile(`${buildRoot}/manifests/stop-osm-overrides.json`, 'utf8').then(
      JSON.parse,
    ),
    readFile(resolve(options.query), 'utf8'),
  ]);
  const candidates = overrides.overrides
    .filter((item) => item.active && item.reviewed)
    .slice(0, 20);
  if (candidates.length !== 20) {
    throw new Error(
      `Expected 20 reviewed overrides, got ${candidates.length}.`,
    );
  }
  await mkdir(`${outputDir}/responses`, { recursive: true });
  const results = [];
  for (const [index, item] of candidates.entries()) {
    const destination = destinationFor(item);
    const request = {
      operationName: 'PlanTokyo',
      query,
      variables: {
        origin: {
          label: item.stopName,
          location: {
            coordinate: {
              latitude: item.override.lat,
              longitude: item.override.lon,
            },
          },
        },
        destination: {
          label: destination.name,
          location: {
            coordinate: {
              latitude: destination.lat,
              longitude: destination.lon,
            },
          },
        },
        dateTime: { earliestDeparture: DEPARTURE_TIME },
        first: 12,
      },
    };
    const response = await fetch(`${options.baseUrl}/otp/gtfs/v1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en',
        OTPTimeout: '180000',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(190_000),
    });
    const body = await response.json();
    const expectedGtfsStopId = `${item.feedId}:${item.stopId}`;
    const evaluation = evaluateStopResponse(body, expectedGtfsStopId);
    const id = `${String(index + 1).padStart(2, '0')}-${safeId(item.stopId)}`;
    await Promise.all([
      writeFile(
        `${outputDir}/responses/${id}.request.json`,
        `${JSON.stringify(request, null, 2)}\n`,
      ),
      writeFile(
        `${outputDir}/responses/${id}.response.json`,
        `${JSON.stringify(body, null, 2)}\n`,
      ),
    ]);
    results.push({
      id,
      feedId: item.feedId,
      stopId: item.stopId,
      stopName: item.stopName,
      expectedGtfsStopId,
      destination: destination.name,
      ...evaluation,
    });
    process.stdout.write(`${id}: ${evaluation.status}\n`);
  }
  const summary = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    departureTime: DEPARTURE_TIME,
    status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    passed: results.filter((item) => item.status === 'PASS').length,
    failed: results.filter((item) => item.status === 'FAIL').length,
    assertion:
      'At least one valid itinerary boards transit at the exact overridden GTFS stop.',
    results,
  };
  await writeFile(
    `${outputDir}/summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(`${outputDir}/report.md`, buildMarkdown(summary));
  process.stdout.write(
    `${JSON.stringify({ outputDir, status: summary.status, passed: summary.passed, failed: summary.failed }, null, 2)}\n`,
  );
  if (summary.status !== 'PASS') process.exitCode = 1;
}

function destinationFor(item) {
  if (item.feedId === 'jp-tokyo-jr-east') {
    return item.stopId === 'jr-east:東京'
      ? { name: 'Shinjuku', lat: 35.6889594, lon: 139.7002855 }
      : { name: 'Tokyo', lat: 35.6815845, lon: 139.7660203 };
  }
  return { name: 'Shimbashi', lat: 35.665386, lon: 139.759338 };
}

function buildMarkdown(summary) {
  const rows = summary.results.map(
    (item) =>
      `| ${item.stopName} | ${item.feedId} | \`${item.stopId}\` | ${item.destination} | ${item.status} | ${item.matchingBoardingCount} |`,
  );
  return `# Reviewed stop linking smoke test

- Status: **${summary.status}**
- Passed: ${summary.passed}; failed: ${summary.failed}
- Assertion: ${summary.assertion}
- Departure: \`${summary.departureTime}\`

| Stop | Feed | stop_id | Destination | Status | Matching itineraries |
| --- | --- | --- | --- | --- | ---: |
${rows.join('\n')}
`;
}

function safeId(value) {
  return value.replaceAll(/[^\p{L}\p{N}-]+/gu, '-');
}

function parseArgs(args) {
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    baseUrl: 'http://localhost:8080',
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
