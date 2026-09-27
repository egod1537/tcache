#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.reviewedBy || !options.reviewReference) {
    throw new Error('--reviewed-by and --review-reference are required.');
  }
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const [manifest, sourceChange, coverage, linking, transfer, performance] =
    await Promise.all([
      readJson(`${buildRoot}/manifests/build-manifest.json`),
      readJson(`${buildRoot}/quality/source-change.json`),
      readJson(`${buildRoot}/quality/coverage.json`),
      readJson(`${buildRoot}/quality/linking-quality.json`),
      readJson(`${buildRoot}/quality/transfer-quality.json`),
      readJson(`${buildRoot}/quality/performance-metrics.json`),
    ]);
  if (sourceChange.status !== 'PASS') {
    throw new Error('Source-change gate must pass before baseline capture.');
  }
  if (
    coverage.loadedFeedCount !== 12 ||
    coverage.rows.some(
      (row) => !['VERIFIED', 'VERIFIED_WITH_WARNING'].includes(row.status),
    )
  ) {
    throw new Error('All 12 feeds and required lines must be verified.');
  }
  if (
    transfer.smokeTests.total !== 148 ||
    transfer.smokeTests.passRate !== 1 ||
    linking.validatorErrors !== 0 ||
    linking.criticalStationFailures.length > 0 ||
    linking.criticalStations.length !== 16
  ) {
    throw new Error('Regression, validator, and critical stations must pass.');
  }
  for (const value of [
    performance.graph.bytes,
    performance.build.durationSeconds,
    performance.build.approximatePeakMemoryMiB,
    performance.startup.durationSeconds,
    performance.startup.idleMemoryMiB,
    performance.routingQueries.p50Milliseconds,
    performance.routingQueries.p95Milliseconds,
    performance.routingQueries.maxMilliseconds,
  ]) {
    if (!Number.isFinite(value)) {
      throw new Error('Performance baseline contains a missing measurement.');
    }
  }
  const baseline = {
    schemaVersion: '1.0',
    buildId: manifest.buildId,
    capturedAt: new Date().toISOString(),
    reviewStatus: 'APPROVED',
    reviewedBy: options.reviewedBy,
    reviewReference: options.reviewReference,
    immutableUntilExplicitRecapture: true,
    metrics: { linking, transfer, performance },
  };
  const output = resolveRepositoryPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, {
    flag: options.replace === 'true' ? 'w' : 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({ output, buildId: manifest.buildId }, null, 2)}\n`,
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
    buildRoot: 'otp/data/japan/tokyo/builds/candidate',
    output: 'otp/baselines/tokyo-rail-production.json',
    replace: 'false',
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
