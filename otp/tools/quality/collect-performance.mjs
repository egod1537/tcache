#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function buildPerformanceMetrics({
  buildId,
  build,
  runtime,
  smoke,
  baseline = null,
}) {
  const latencies = smoke.results
    .map((result) => result.queryLatencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (latencies.length !== smoke.results.length) {
    throw new Error(
      `Query latency is missing for ${smoke.results.length - latencies.length} smoke result(s).`,
    );
  }

  const metrics = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    buildId,
    graph: {
      bytes: numberOrNull(build.graphBytes),
      sha256: build.graphSha256 ?? null,
    },
    build: {
      durationSeconds: numberOrNull(build.durationSeconds),
      approximatePeakMemoryMiB: numberOrNull(build.approximatePeakMemoryMiB),
    },
    startup: {
      durationSeconds: numberOrNull(runtime.startupDurationSeconds),
      idleMemoryObserved: runtime.idleMemoryObserved ?? null,
      idleMemoryMiB: parseMemoryMiB(runtime.idleMemoryObserved),
    },
    routingQueries: {
      count: latencies.length,
      p50Milliseconds: percentile(latencies, 0.5),
      p95Milliseconds: percentile(latencies, 0.95),
      maxMilliseconds: latencies.at(-1) ?? null,
    },
    sourcePaths: {
      buildSummary: 'manifests/latest-build.json',
      runtimeSummary: 'manifests/latest-runtime.json',
      smokeSummary: 'smoke-tests/latest/summary.json',
    },
  };
  if (baseline) {
    metrics.baseline = {
      buildId: baseline.buildId,
      deltas: buildDeltas(metrics, baseline),
    };
  }
  return metrics;
}

function buildDeltas(current, baseline) {
  return {
    graphBytes: delta(baseline.graph?.bytes, current.graph.bytes),
    buildDurationSeconds: delta(
      baseline.build?.durationSeconds,
      current.build.durationSeconds,
    ),
    buildPeakMemoryMiB: delta(
      baseline.build?.approximatePeakMemoryMiB,
      current.build.approximatePeakMemoryMiB,
    ),
    startupDurationSeconds: delta(
      baseline.startup?.durationSeconds,
      current.startup.durationSeconds,
    ),
    startupIdleMemoryMiB: delta(
      baseline.startup?.idleMemoryMiB,
      current.startup.idleMemoryMiB,
    ),
    queryP50Milliseconds: delta(
      baseline.routingQueries?.p50Milliseconds,
      current.routingQueries.p50Milliseconds,
    ),
    queryP95Milliseconds: delta(
      baseline.routingQueries?.p95Milliseconds,
      current.routingQueries.p95Milliseconds,
    ),
    queryMaxMilliseconds: delta(
      baseline.routingQueries?.maxMilliseconds,
      current.routingQueries.maxMilliseconds,
    ),
  };
}

function delta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(percentileValue * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function parseMemoryMiB(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([0-9.]+)\s*([KMG]i?B)/i);
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('G')) return number * 1024;
  if (unit.startsWith('K')) return number / 1024;
  return number;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const manifest = await readJson(`${buildRoot}/manifests/build-manifest.json`);
  const smokePath = manifest.smokeTests?.summaryPath;
  if (!smokePath) throw new Error('Build manifest has no smoke summary path.');
  const baseline = options.baseline
    ? await readJson(resolveRepositoryPath(options.baseline))
    : null;
  const metrics = buildPerformanceMetrics({
    buildId: manifest.buildId,
    build:
      manifest.graph?.summary ??
      (await readJson(`${buildRoot}/manifests/latest-build.json`)),
    runtime:
      manifest.startup?.summary ??
      (await readJson(`${buildRoot}/manifests/latest-runtime.json`)),
    smoke: await readJson(`${buildRoot}/${smokePath}`),
    baseline,
  });
  const output = options.output
    ? resolveRepositoryPath(options.output)
    : `${buildRoot}/quality/performance-metrics.json`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, metrics }, null, 2)}\n`);
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
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
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
