#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function buildCoverageReport({
  registry,
  manifest,
  smoke,
  sourceChange = null,
  linking = null,
}) {
  const preflightByFeed = new Map(
    (manifest.preflight?.feeds ?? []).map((feed) => [feed.feedId, feed]),
  );
  const loadedFeeds = new Set(
    (manifest.inputs ?? []).map((input) => input.feedId).filter(Boolean),
  );
  const sourceByFeed = new Map(
    (sourceChange?.feeds ?? []).map((feed) => [feed.feedId, feed]),
  );
  const linkingByFeed = linking?.perFeed ?? {};
  const passingResults = (smoke?.results ?? []).filter(
    (result) => result.status === 'PASS',
  );
  const rows = registry.feeds.flatMap((feed) => {
    const preflight = preflightByFeed.get(feed.feedId);
    const source = sourceByFeed.get(feed.feedId);
    const feedResults = passingResults.filter((result) =>
      (result.feeds ?? []).includes(feed.feedId),
    );
    return feed.lines.map((line) => {
      const sourceReady = source?.status === 'PASS';
      const valid = preflight?.errorCount === 0;
      const loaded = loadedFeeds.has(feed.feedId);
      const tested = feedResults.some(
        (result) =>
          line.routeCode === null ||
          (result.routes ?? []).includes(line.routeCode),
      );
      const warnings = [
        ...(source?.warnings ?? []),
        ...(Number(preflight?.warningCount ?? 0) > 0
          ? [`GTFS validator warnings: ${preflight.warningCount}`]
          : []),
      ];
      return {
        feedId: feed.feedId,
        operator: feed.operator,
        lineId: line.id,
        line: line.name,
        routeCode: line.routeCode,
        source: feed.sourceType,
        sourceStatus: feed.currentSourceStatus,
        datasetVersion: source?.datasetVersion ?? null,
        sourceAgeHours: source?.sourceAgeHours ?? null,
        valid,
        loaded,
        tested,
        linkedRatio: ratio(
          linkingByFeed[feed.feedId]?.linkedStops,
          linkingByFeed[feed.feedId]?.totalStops,
        ),
        unlinkedTransferRatio: ratio(
          linkingByFeed[feed.feedId]?.unlinkedTransferStops,
          linkingByFeed[feed.feedId]?.totalStops,
        ),
        regressionPassRate: ratio(
          feedResults.length,
          (smoke?.results ?? []).filter((result) =>
            (result.feeds ?? []).includes(feed.feedId),
          ).length,
        ),
        warnings,
        status: coverageStatus({
          feed,
          sourceReady,
          valid,
          loaded,
          tested,
          warnings,
        }),
      };
    });
  });
  const statuses = Object.fromEntries(
    ['VERIFIED', 'VERIFIED_WITH_WARNING', 'PARTIAL', 'BLOCKED', 'EXCLUDED'].map(
      (status) => [status, rows.filter((row) => row.status === status).length],
    ),
  );
  const feedStatuses = registry.feeds.map((feed) => {
    const feedRows = rows.filter((row) => row.feedId === feed.feedId);
    const feedLinking = linkingByFeed[feed.feedId];
    return {
      feedId: feed.feedId,
      operator: feed.operator,
      datasetVersion:
        feedRows.find((row) => row.datasetVersion)?.datasetVersion ?? null,
      sourceAgeHours:
        feedRows.find((row) => row.sourceAgeHours !== null)?.sourceAgeHours ??
        null,
      validatorStatus: feedRows.every((row) => row.valid) ? 'PASS' : 'FAIL',
      graphIncluded: feedRows.every((row) => row.loaded),
      linkedRatio: ratio(feedLinking?.linkedStops, feedLinking?.totalStops),
      unlinkedTransferRatio: ratio(
        feedLinking?.unlinkedTransferStops,
        feedLinking?.totalStops,
      ),
      regressionPassRate: ratio(
        passingResults.filter((result) =>
          (result.feeds ?? []).includes(feed.feedId),
        ).length,
        (smoke?.results ?? []).filter((result) =>
          (result.feeds ?? []).includes(feed.feedId),
        ).length,
      ),
      status: worstStatus(feedRows.map((row) => row.status)),
    };
  });
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    buildId: manifest.buildId,
    registryVersion: registry.registryVersion,
    expectedFeedCount: registry.requiredFeedCount,
    loadedFeedCount: loadedFeeds.size,
    routeRegression: {
      passed: smoke?.passed ?? 0,
      failed: smoke?.failed ?? 0,
      passRate: ratio(
        smoke?.passed,
        (smoke?.passed ?? 0) + (smoke?.failed ?? 0),
      ),
    },
    statuses,
    feedStatuses,
    rows,
  };
}

function coverageStatus({
  feed,
  sourceReady,
  valid,
  loaded,
  tested,
  warnings,
}) {
  if (!feed.lines.some((line) => line.required)) return 'EXCLUDED';
  if (
    feed.currentSourceStatus === 'BLOCKED_SOURCE' ||
    feed.sourceType === 'unresolved'
  ) {
    return 'BLOCKED';
  }
  if (!sourceReady && feed.currentSourceStatus.startsWith('BLOCKED')) {
    return 'BLOCKED';
  }
  if (!sourceReady || !valid || !loaded || !tested) return 'PARTIAL';
  return warnings.length > 0 ? 'VERIFIED_WITH_WARNING' : 'VERIFIED';
}

function worstStatus(statuses) {
  const order = [
    'BLOCKED',
    'PARTIAL',
    'VERIFIED_WITH_WARNING',
    'VERIFIED',
    'EXCLUDED',
  ];
  return order.find((status) => statuses.includes(status)) ?? 'BLOCKED';
}

function ratio(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

export function renderCoverageMarkdown(report) {
  const lines = [
    '# Tokyo rail coverage report',
    '',
    `- Build: \`${report.buildId}\``,
    `- Feeds loaded: ${report.loadedFeedCount}/${report.expectedFeedCount}`,
    `- Regression: ${report.routeRegression.passed} passed, ${report.routeRegression.failed} failed`,
    '',
    '| Operator | Line | Source | Valid | Loaded | Tested | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of report.rows) {
    lines.push(
      `| ${row.operator} | ${row.line} | ${row.source} | ${yesNo(row.valid)} | ${yesNo(row.loaded)} | ${yesNo(row.tested)} | ${row.status} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function yesNo(value) {
  return value ? 'YES' : 'NO';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const manifest = await readJson(`${buildRoot}/manifests/build-manifest.json`);
  const smokePath = manifest.smokeTests?.summaryPath;
  const [registry, smoke, sourceChange, linking] = await Promise.all([
    readJson(resolveRepositoryPath(options.registry)),
    smokePath ? readJson(`${buildRoot}/${smokePath}`) : Promise.resolve(null),
    readOptionalJson(`${buildRoot}/quality/source-change.json`),
    readOptionalJson(`${buildRoot}/quality/linking-quality.json`),
  ]);
  const report = buildCoverageReport({
    registry,
    manifest,
    smoke,
    sourceChange,
    linking,
  });
  const outputDirectory = resolve(
    options.outputDirectory ?? `${buildRoot}/quality`,
  );
  const filePrefix = options.filePrefix ?? '';
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      `${outputDirectory}/${filePrefix}coverage.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(
      `${outputDirectory}/${filePrefix}coverage-report.md`,
      renderCoverageMarkdown(report),
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ outputDirectory, statuses: report.statuses }, null, 2)}\n`,
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    registry: 'otp/config/tokyo-rail-production-registry.json',
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
