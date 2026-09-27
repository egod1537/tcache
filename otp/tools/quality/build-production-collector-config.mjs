#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function buildProductionCollectorConfig(registry, stationReview) {
  const byId = new Map(
    stationReview.complexes.map((complex) => [complex.id, complex]),
  );
  const criticalStations = registry.criticalStationComplexIds.map((id) => {
    const complex = byId.get(id);
    if (!complex) throw new Error(`Critical station ${id} is not reviewed.`);
    return {
      id: id.replace(/^tokyo:/u, ''),
      name: complex.officialNameEn ?? complex.officialNameJa,
      members: complex.members,
    };
  });
  return {
    schemaVersion: '1.0',
    metricDefinitions: {
      stopCohort:
        'location_type=0 stops referenced by at least one stop_times route',
      linkedStop:
        'A cohort stop with no IsolatedStop or PrunedStopIsland warning',
      unlinkedTransferRatio:
        'StopNotLinkedForTransfers warning events divided by cohort total stops',
      snappingDistance:
        'Point-to-nearest walkable OSM segment distance across the full stop cohort',
    },
    criticalStations,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [registry, stationReview] = await Promise.all([
    readJson(resolveRepositoryPath(options.registry)),
    readJson(resolveRepositoryPath(options.stationReview)),
  ]);
  const config = buildProductionCollectorConfig(registry, stationReview);
  const output = resolveRepositoryPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, criticalStations: config.criticalStations.length }, null, 2)}\n`,
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    registry: 'otp/config/tokyo-rail-production-registry.json',
    stationReview: 'otp/config/station-complex-review.json',
    output:
      'otp/data/japan/tokyo/builds/candidate/manifests/production-linking-collector.json',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[
      key
        .slice(2)
        .replace(/-([a-z])/g, (_, character) => character.toUpperCase())
    ] = args[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
