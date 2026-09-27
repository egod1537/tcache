#!/usr/bin/env node

import { createHash } from 'node:crypto';
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
  const [registry, snapshot] = await Promise.all([
    readJson(resolveRepositoryPath(options.registry)),
    readJson(resolveRepositoryPath(options.snapshot)),
  ]);
  const expected = registry.feeds.map((feed) => feed.feedId).sort();
  const observed = snapshot.feeds.map((feed) => feed.feedId).sort();
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new Error('Snapshot feed set does not exactly match the registry.');
  }
  for (const registered of registry.feeds) {
    if (registered.sourceType === 'unresolved' || !registered.adapterVersion) {
      throw new Error(
        `${registered.feedId} has no approved source/adapter contract.`,
      );
    }
    const feed = snapshot.feeds.find(
      (candidate) => candidate.feedId === registered.feedId,
    );
    if (
      !/^[a-f0-9]{64}$/u.test(feed.sourceSha256 ?? '') ||
      !/^[a-f0-9]{64}$/u.test(feed.gtfsSha256 ?? '') ||
      feed.parserStructureVersion !== registered.adapterVersion ||
      !Number.isInteger(feed.stationCount) ||
      feed.stationCount < 1 ||
      !Number.isFinite(feed.parseCoverage) ||
      feed.parseCoverage < 0.95 ||
      feed.parseCoverage > 1 ||
      feed.validatorErrorCount !== 0
    ) {
      throw new Error(
        `${registered.feedId} source snapshot is not baseline-ready.`,
      );
    }
  }
  const canonicalFeeds = [...snapshot.feeds]
    .sort((left, right) => left.feedId.localeCompare(right.feedId))
    .map((feed) => ({
      feedId: feed.feedId,
      sourceSha256: feed.sourceSha256,
      gtfsSha256: feed.gtfsSha256,
      sourceEdition: feed.sourceEdition ?? null,
      gtfsVersion: feed.gtfsVersion ?? null,
      parserStructureVersion: feed.parserStructureVersion,
      stationCount: feed.stationCount,
      parseCoverage: feed.parseCoverage,
      validatorErrorCount: feed.validatorErrorCount,
      collectedAt: feed.collectedAt,
    }));
  const baselineId = `tokyo-rail-sources-${createHash('sha256')
    .update(JSON.stringify(canonicalFeeds))
    .digest('hex')
    .slice(0, 16)}`;
  const baseline = {
    schemaVersion: '1.0',
    baselineId,
    registryVersion: registry.registryVersion,
    capturedAt: new Date().toISOString(),
    reviewStatus: 'APPROVED',
    reviewedBy: options.reviewedBy,
    reviewReference: options.reviewReference,
    immutableUntilExplicitRecapture: true,
    feeds: canonicalFeeds,
  };
  const output = resolveRepositoryPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, {
    flag: options.replace === 'true' ? 'w' : 'wx',
  });
  process.stdout.write(`${JSON.stringify({ output, baselineId }, null, 2)}\n`);
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
    snapshot:
      'otp/data/japan/tokyo/builds/candidate/manifests/source-snapshot.json',
    output: 'otp/baselines/tokyo-rail-sources.json',
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
