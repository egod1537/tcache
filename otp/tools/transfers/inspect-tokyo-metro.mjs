#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { strFromU8, unzipSync } from 'fflate';

import { parseCsv } from './lib.mjs';

const EXPECTED_ROUTES = ['C', 'F', 'G', 'H', 'M', 'N', 'T', 'Y', 'Z'];

export function inspectTokyoMetroArchive(input) {
  const archive = unzipSync(new Uint8Array(input));
  const readCsv = (name, required = true) => {
    const value = archive[name];
    if (!value) {
      if (required) throw new Error(`Tokyo Metro GTFS has no ${name}.`);
      return [];
    }
    return parseCsv(strFromU8(value));
  };
  const agencies = readCsv('agency.txt');
  const routes = readCsv('routes.txt');
  const stops = readCsv('stops.txt');
  const trips = readCsv('trips.txt');
  const stopTimes = readCsv('stop_times.txt');
  const calendars = readCsv('calendar.txt', false);
  const calendarDates = readCsv('calendar_dates.txt', false);
  const feedInfo = readCsv('feed_info.txt')[0];
  const routeNames = [...new Set(routes.map((route) => route.route_short_name))]
    .filter(Boolean)
    .sort();
  if (JSON.stringify(routeNames) !== JSON.stringify(EXPECTED_ROUTES)) {
    throw new Error(
      `Tokyo Metro route contract changed: ${JSON.stringify(routeNames)}.`,
    );
  }
  if (routes.some((route) => Number(route.route_type) !== 1)) {
    throw new Error('Tokyo Metro feed contains a non-subway route_type.');
  }
  const routeIds = new Set(routes.map((route) => route.route_id));
  const unknownTripRoutes = trips.filter(
    (trip) => !routeIds.has(trip.route_id),
  );
  if (unknownTripRoutes.length > 0) {
    throw new Error(
      `${unknownTripRoutes.length} Tokyo Metro trips reference unknown routes.`,
    );
  }
  const stopIds = new Set(stops.map((stop) => stop.stop_id));
  const missingStopReferences = stopTimes.filter(
    (stopTime) => !stopIds.has(stopTime.stop_id),
  );
  if (missingStopReferences.length > 0) {
    throw new Error(
      `${missingStopReferences.length} stop_times reference unknown stops.`,
    );
  }
  const blocks = new Map();
  for (const trip of trips) {
    if (!trip.block_id) continue;
    const block = blocks.get(trip.block_id) ?? new Set();
    block.add(trip.route_id);
    blocks.set(trip.block_id, block);
  }
  const multiRouteBlocks = [...blocks.values()].filter(
    (routeSet) => routeSet.size > 1,
  ).length;
  const locationTypes = Object.fromEntries(
    [...new Set(stops.map((stop) => stop.location_type || '0'))]
      .sort()
      .map((locationType) => [
        locationType,
        stops.filter((stop) => (stop.location_type || '0') === locationType)
          .length,
      ]),
  );
  return {
    schemaVersion: '1.0',
    feedId: 'jp-tokyo-metro',
    operator: agencies[0]?.agency_name ?? 'Tokyo Metro Co., Ltd.',
    feedVersion: feedInfo?.feed_version ?? null,
    publisher: feedInfo?.feed_publisher_name ?? null,
    serviceWindow: {
      start: feedInfo?.feed_start_date ?? null,
      end: feedInfo?.feed_end_date ?? null,
    },
    routeShortNames: routeNames,
    counts: {
      agencies: agencies.length,
      routes: routes.length,
      stops: stops.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      calendars: calendars.length,
      calendarDates: calendarDates.length,
      stopsWithParentStation: stops.filter((stop) => stop.parent_station)
        .length,
      stopsByLocationType: locationTypes,
      blocks: blocks.size,
      multiRouteBlocks,
    },
    hierarchyPolicy: {
      sourceArchiveModified: false,
      parentStationPreserved: true,
      platformAndEntranceRecordsPreserved: true,
    },
    throughServicePolicy: {
      sourceTripsAndBlockIdsPreserved: true,
      syntheticTripMergeAllowed: false,
      observedMultiRouteBlocks: multiRouteBlocks,
    },
    contractStatus: 'PASS',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.feed || !options.output) {
    throw new Error(
      'Usage: inspect-tokyo-metro.mjs --feed FEED.zip --output metadata.json',
    );
  }
  const input = await readFile(resolve(options.feed));
  const metadata = {
    ...inspectTokyoMetroArchive(input),
    sha256: createHash('sha256').update(input).digest('hex'),
    source: {
      type: 'official-gtfs',
      url: 'https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip',
      credentialStored: false,
    },
  };
  await writeFile(
    resolve(options.output),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[key.slice(2)] = value;
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
