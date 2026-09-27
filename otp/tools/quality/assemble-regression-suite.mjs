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

export function assembleRegressionSuite(sourceConfig, sourceDocuments) {
  if (sourceDocuments.length !== sourceConfig.sources.length) {
    throw new Error('Regression source document count does not match config.');
  }
  const departureTimes = new Set(
    sourceDocuments.map((document) => document.departureTime),
  );
  if (departureTimes.size !== 1) {
    throw new Error('Regression sources use different departure times.');
  }
  const routes = sourceDocuments.flatMap((document) =>
    document.routes.map((route) => ({
      ...route,
      qualityConstraints: {
        ...sourceConfig.defaultQualityConstraints,
        ...(route.qualityConstraints ?? {}),
      },
    })),
  );
  const ids = routes.map((route) => route.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate regression route IDs: ${[...new Set(duplicateIds)].join(', ')}`,
    );
  }
  if (routes.length < sourceConfig.minimumRouteCount) {
    throw new Error(
      `Regression route count ${routes.length} is below ${sourceConfig.minimumRouteCount}.`,
    );
  }
  if (
    sourceConfig.expectedRouteCount !== undefined &&
    routes.length !== sourceConfig.expectedRouteCount
  ) {
    throw new Error(
      `Regression route count ${routes.length} does not equal ${sourceConfig.expectedRouteCount}.`,
    );
  }
  const coveredFeeds = new Set(
    routes.flatMap((route) => route.requiredFeeds ?? []),
  );
  const missingFeeds = sourceConfig.requiredFeedIds.filter(
    (feedId) => !coveredFeeds.has(feedId),
  );
  if (missingFeeds.length > 0) {
    throw new Error(
      `Regression suite misses feeds: ${missingFeeds.join(', ')}`,
    );
  }
  const coverageGroups = buildCoverageGroups(routes);
  const missingGroups = Object.entries(coverageGroups)
    .filter(([, count]) => count === 0)
    .map(([group]) => group);
  if (missingGroups.length > 0) {
    throw new Error(
      `Regression suite misses groups: ${missingGroups.join(', ')}`,
    );
  }
  return {
    schemaVersion: '1.0',
    departureTime: [...departureTimes][0],
    itineraryCount: Math.max(
      ...sourceDocuments.map((document) => document.itineraryCount),
    ),
    contract: {
      minimumRouteCount: sourceConfig.minimumRouteCount,
      requiredFeedIds: sourceConfig.requiredFeedIds,
      sourceFiles: sourceConfig.sources,
      defaultQualityConstraints: sourceConfig.defaultQualityConstraints,
      sourceHashes: sourceDocuments.map((document) =>
        createHash('sha256')
          .update(`${JSON.stringify(document)}\n`)
          .digest('hex'),
      ),
      routeCount: routes.length,
      coverageGroups,
    },
    routes,
  };
}

function buildCoverageGroups(routes) {
  const count = (predicate) => routes.filter(predicate).length;
  const categoryIncludes = (route, value) => route.category.includes(value);
  const idIncludes = (route, value) => route.id.toLowerCase().includes(value);
  return {
    centralJr: count((route) => route.category === 'JR_ONLY'),
    metro: count((route) => route.category === 'METRO_ONLY'),
    jrMetro: count((route) => categoryIncludes(route, 'JR_METRO')),
    jrPrivate: count(
      (route) =>
        categoryIncludes(route, 'JR_PRIVATE') ||
        categoryIncludes(route, 'PRIVATE_JR'),
    ),
    metroPrivate: count(
      (route) =>
        categoryIncludes(route, 'METRO_PRIVATE') ||
        categoryIncludes(route, 'PRIVATE_METRO'),
    ),
    privatePrivate: count((route) =>
      categoryIncludes(route, 'PRIVATE_PRIVATE'),
    ),
    toei: count(
      (route) =>
        categoryIncludes(route, 'TOEI') ||
        categoryIncludes(route, 'BUS_INCLUDED'),
    ),
    haneda: count((route) => idIncludes(route, 'haneda')),
    narita: count((route) => idIncludes(route, 'narita')),
    yokohama: count(
      (route) =>
        idIncludes(route, 'yokohama') || categoryIncludes(route, 'YOKOHAMA'),
    ),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolveRepositoryPath(options.config);
  const sourceConfig = JSON.parse(await readFile(configPath, 'utf8'));
  const documents = await Promise.all(
    sourceConfig.sources.map((source) =>
      readFile(resolve(REPOSITORY_ROOT, 'otp', source), 'utf8').then(
        JSON.parse,
      ),
    ),
  );
  const suite = assembleRegressionSuite(sourceConfig, documents);
  const output = resolveRepositoryPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(suite, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, routeCount: suite.routes.length, coverageGroups: suite.contract.coverageGroups }, null, 2)}\n`,
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    config: 'otp/config/tokyo-rail-regression-sources.json',
    output: 'otp/config/tokyo-rail-regression-suite.json',
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
