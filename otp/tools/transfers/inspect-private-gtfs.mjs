#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { strFromU8, unzipSync } from 'fflate';

import { parseCsv } from './lib.mjs';

const PROFILES = {
  keio: {
    feedId: 'jp-tokyo-keio',
    source:
      'https://api-challenge.odpt.org/api/v4/files/Keio/data/Keio-Train-GTFS.zip',
    lines: [
      { id: 'keio', patterns: [/京王線/u, /Keio Line/i] },
      { id: 'inokashira', patterns: [/井の頭線/u, /Inokashira/i] },
      { id: 'takao', patterns: [/高尾線/u, /Takao/i] },
      { id: 'sagamihara', patterns: [/相模原線/u, /Sagamihara/i] },
    ],
  },
  tobu: {
    feedId: 'jp-tokyo-tobu',
    source:
      'https://api-challenge.odpt.org/api/v4/files/Tobu/data/Tobu-Train-GTFS.zip',
    lines: [
      { id: 'tojo', patterns: [/東上/u, /Tojo/i] },
      {
        id: 'skytree',
        patterns: [/スカイツリー/u, /伊勢崎/u, /Skytree/i, /Isesaki/i],
      },
    ],
  },
  sotetsu: {
    feedId: 'jp-tokyo-sotetsu',
    source:
      'https://api-challenge.odpt.org/api/v4/files/Sotetsu/data/Sotetsu-Train-GTFS.zip',
    lines: [
      { id: 'main', patterns: [/本線/u, /Main/i] },
      { id: 'izumino', patterns: [/いずみ野/u, /Izumino/i] },
    ],
  },
};

export function inspectOfficialPrivateGtfs(input, profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown private GTFS profile ${profileName}.`);
  const archive = unzipSync(new Uint8Array(input));
  const csv = (name, required = true) => {
    const value = archive[name];
    if (!value) {
      if (required) throw new Error(`${profileName} GTFS has no ${name}.`);
      return [];
    }
    return parseCsv(strFromU8(value));
  };
  const agencies = csv('agency.txt');
  const routes = csv('routes.txt');
  const stops = csv('stops.txt');
  const trips = csv('trips.txt');
  const stopTimes = csv('stop_times.txt');
  const feedInfo = csv('feed_info.txt', false)[0];
  const routeText = routes.map((route) =>
    [route.route_short_name, route.route_long_name, route.route_desc]
      .filter(Boolean)
      .join(' '),
  );
  if (routes.some((route) => Number(route.route_type) !== 2)) {
    throw new Error(`${profileName} GTFS contains a non-rail route_type.`);
  }
  const matchedLines = profile.lines.filter((line) =>
    routeText.some((text) =>
      line.patterns.some((pattern) => pattern.test(text)),
    ),
  );
  const missingLines = profile.lines
    .filter((line) => !matchedLines.includes(line))
    .map((line) => line.id);
  if (missingLines.length > 0) {
    throw new Error(
      `${profileName} GTFS is missing target line contracts: ${missingLines.join(', ')}.`,
    );
  }
  const routeIds = new Set(routes.map((route) => route.route_id));
  const stopIds = new Set(stops.map((stop) => stop.stop_id));
  if (trips.some((trip) => !routeIds.has(trip.route_id))) {
    throw new Error(`${profileName} trips reference an unknown route.`);
  }
  if (stopTimes.some((stopTime) => !stopIds.has(stopTime.stop_id))) {
    throw new Error(`${profileName} stop_times reference an unknown stop.`);
  }
  return {
    schemaVersion: '1.0',
    feedId: profile.feedId,
    operator: agencies[0]?.agency_name ?? profileName,
    feedVersion: feedInfo?.feed_version ?? null,
    targetLines: matchedLines.map((line) => line.id),
    counts: {
      agencies: agencies.length,
      routes: routes.length,
      stops: stops.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      stopsWithParentStation: stops.filter((stop) => stop.parent_station)
        .length,
    },
    hierarchyPolicy: {
      sourceArchiveModified: false,
      parentStationPreserved: true,
      platformAndEntranceRecordsPreserved: true,
    },
    throughServicePolicy: {
      sourceTripsAndBlockIdsPreserved: true,
      syntheticTripMergeAllowed: false,
    },
    contractStatus: 'PASS',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.feed || !options.output || !options.profile) {
    throw new Error(
      'Usage: inspect-private-gtfs.mjs --profile keio|tobu|sotetsu --feed FEED.zip --output metadata.json',
    );
  }
  const input = await readFile(resolve(options.feed));
  const metadata = {
    ...inspectOfficialPrivateGtfs(input, options.profile),
    sha256: createHash('sha256').update(input).digest('hex'),
    source: {
      type: 'official-gtfs',
      url: PROFILES[options.profile]?.source,
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
