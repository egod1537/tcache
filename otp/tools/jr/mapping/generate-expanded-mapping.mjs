#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const LINE_PREFIX = {
  'jr-east:yamanote': 'JY',
  'jr-east:chuo-rapid': 'JC',
  'jr-east:chuo-sobu-local': 'JB',
  'jr-east:keihin-tohoku': 'JK',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = await readJson(resolveRepositoryPath(options.dataset));
  const existing = await readJson(resolveRepositoryPath(options.existing));
  const pbf = resolveRepositoryPath(options.pbf);
  const temporary = await mkdtemp(`${tmpdir()}/tcache-jr-mapping-`);
  try {
    const filtered = `${temporary}/rail-stops.osm.pbf`;
    const geojson = `${temporary}/rail-stops.geojsonseq`;
    await execFileAsync('osmium', [
      'tags-filter',
      pbf,
      'nwr/railway=stop,station,halt',
      'nwr/public_transport=stop_position',
      '-o',
      filtered,
    ]);
    await execFileAsync('osmium', [
      'export',
      filtered,
      '-f',
      'geojsonseq',
      '-u',
      'type_id',
      '-o',
      geojson,
    ]);
    const features = (await readFile(geojson, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) =>
        JSON.parse(line.charCodeAt(0) === 0x1e ? line.slice(1) : line),
      )
      .filter((feature) => feature.geometry?.type === 'Point');
    const existingById = new Map(
      existing.mappings.map((mapping) => [mapping.internalStationId, mapping]),
    );
    const expectedPrefixes = buildExpectedPrefixes(dataset);
    const mappings = dataset.stations
      .map((station) => {
        const retained = existingById.get(station.id);
        if (retained) return retained;
        const prefixes = expectedPrefixes.get(station.id) ?? new Set();
        const candidates = features.filter((feature) => {
          const properties = feature.properties ?? {};
          const name = properties['name:ja'] ?? properties.name;
          const ref = properties.ref ?? properties['railway:ref'] ?? '';
          return (
            name === station.nameJa &&
            [...prefixes].some((prefix) =>
              new RegExp(`^${prefix}\\d+$`).test(ref),
            )
          );
        });
        if (candidates.length === 0) {
          return {
            internalStationId: station.id,
            operator: 'jr-east',
            officialNameJa: station.nameJa,
            mappingStatus: 'candidate',
          };
        }
        const selected = medoid(candidates);
        const [longitude, latitude] = selected.geometry.coordinates;
        const ref =
          selected.properties.ref ?? selected.properties['railway:ref'];
        const idMatch = /^(node|way|relation|n|w|r)\/?(\d+)$/.exec(
          String(selected.id),
        );
        if (!idMatch)
          throw new Error(`Unexpected OSM element ID: ${selected.id}`);
        const elementType =
          { n: 'node', w: 'way', r: 'relation' }[idMatch[1]] ?? idMatch[1];
        return {
          internalStationId: station.id,
          operator: 'jr-east',
          officialNameJa: station.nameJa,
          stationNumber: ref,
          osmElementType: elementType,
          osmElementId: Number(idMatch[2]),
          latitude,
          longitude,
          mappingStatus: 'confirmed',
          reviewedAt: options.reviewedAt,
        };
      })
      .sort((left, right) =>
        left.internalStationId.localeCompare(right.internalStationId, 'ja'),
      );
    const unresolved = mappings.filter(
      (mapping) => mapping.mappingStatus !== 'confirmed',
    );
    const output = {
      schemaVersion: '1.0',
      operator: 'jr-east',
      reviewMethod:
        'Existing reviewed Yamanote mappings are retained. New mappings require an exact official Japanese station name plus a JC/JB/JK station-code match on an OSM rail stop_position; a deterministic medoid is selected only among same-station platform candidates. No fuzzy or low-confidence candidate is auto-confirmed.',
      source: {
        name: 'Geofabrik Kanto OpenStreetMap extract, JR-expanded local clip',
        url: 'https://download.geofabrik.de/asia/japan/kanto.html',
        license: 'ODbL 1.0',
        attribution: 'OpenStreetMap contributors',
        retrievedAt: options.reviewedAt,
      },
      mappings,
    };
    await writeFile(
      resolveRepositoryPath(options.output),
      `${JSON.stringify(output, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          output: resolveRepositoryPath(options.output),
          total: mappings.length,
          confirmed: mappings.length - unresolved.length,
          unresolved,
        },
        null,
        2,
      )}\n`,
    );
    if (unresolved.length > 0) process.exitCode = 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function buildExpectedPrefixes(dataset) {
  const result = new Map();
  for (const trip of dataset.trips) {
    const prefix = LINE_PREFIX[trip.lineId];
    if (!prefix) continue;
    for (const stop of trip.stopTimes) {
      const prefixes = result.get(stop.stationId) ?? new Set();
      prefixes.add(prefix);
      result.set(stop.stationId, prefixes);
    }
  }
  return result;
}

function medoid(features) {
  const average = features
    .map((feature) => feature.geometry.coordinates)
    .reduce(
      (sum, [longitude, latitude]) => [
        sum[0] + longitude / features.length,
        sum[1] + latitude / features.length,
      ],
      [0, 0],
    );
  return [...features].sort((left, right) => {
    const leftDistance = squaredDistance(left.geometry.coordinates, average);
    const rightDistance = squaredDistance(right.geometry.coordinates, average);
    return (
      leftDistance - rightDistance ||
      String(left.id).localeCompare(String(right.id))
    );
  })[0];
}

function squaredDistance([leftLon, leftLat], [rightLon, rightLat]) {
  return (leftLon - rightLon) ** 2 + (leftLat - rightLat) ** 2;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function resolveRepositoryPath(path) {
  return isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument: ${key ?? ''}`);
    }
    values.set(key.slice(2), value);
  }
  for (const required of ['dataset', 'pbf']) {
    if (!values.has(required)) throw new Error(`--${required} is required`);
  }
  return {
    dataset: values.get('dataset'),
    pbf: values.get('pbf'),
    existing:
      values.get('existing') ??
      'otp/data/japan/tokyo/jr-east/mappings/yamanote-osm-reviewed.json',
    output:
      values.get('output') ??
      'otp/data/japan/tokyo/jr-east/mappings/expanded-osm-reviewed.json',
    reviewedAt: values.get('reviewed-at') ?? new Date().toISOString(),
  };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
