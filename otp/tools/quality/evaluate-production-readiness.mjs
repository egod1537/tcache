#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function evaluateProductionReadiness(inputs, config, baseline) {
  const failures = [];
  const warnings = [];
  const { manifest, sourceChange, coverage, linking, transfer, performance } =
    inputs;
  failIf(
    failures,
    baseline?.reviewStatus !== 'APPROVED',
    'PRODUCTION_BASELINE_NOT_APPROVED',
    'The 12-feed production baseline is missing or not approved.',
  );
  const loadedFeeds = new Set(
    (manifest.inputs ?? []).map((input) => input.feedId).filter(Boolean),
  );
  failIf(
    failures,
    loadedFeeds.size !== config.requiredFeedCount,
    'FINAL_FEED_COUNT_MISMATCH',
    `Loaded feed count ${loadedFeeds.size} does not equal ${config.requiredFeedCount}.`,
  );
  failIf(
    failures,
    sourceChange.status !== 'PASS',
    'SOURCE_CHANGE_GATE_FAILED',
    'Source freshness/change detection did not pass.',
    sourceChange.failures,
  );
  failIf(
    failures,
    coverage.loadedFeedCount !== config.requiredFeedCount,
    'COVERAGE_FEED_COUNT_MISMATCH',
    `Coverage reports ${coverage.loadedFeedCount}/${config.requiredFeedCount} loaded feeds.`,
  );
  const incompleteRows = coverage.rows.filter(
    (row) => !['VERIFIED', 'VERIFIED_WITH_WARNING'].includes(row.status),
  );
  failIf(
    failures,
    incompleteRows.length > 0,
    'COVERAGE_INCOMPLETE',
    `${incompleteRows.length} required line(s) are not verified.`,
    incompleteRows,
  );
  failIf(
    failures,
    linking.validatorErrors > config.validatorErrorsMax,
    'GTFS_VALIDATOR_ERROR',
    `Validator errors ${linking.validatorErrors} exceed ${config.validatorErrorsMax}.`,
  );
  failIf(
    failures,
    linking.isolatedStopRatio > config.isolatedStopRatioMax,
    'ISOLATED_STOP_BUDGET_EXCEEDED',
    `Isolated ratio ${linking.isolatedStopRatio} exceeds ${config.isolatedStopRatioMax}.`,
  );
  failIf(
    failures,
    linking.osmSnappingDistanceMeters.all.p95 > config.snappingP95HardMaxMeters,
    'SNAPPING_P95_HARD_LIMIT_EXCEEDED',
    `Snapping p95 ${linking.osmSnappingDistanceMeters.all.p95}m exceeds ${config.snappingP95HardMaxMeters}m.`,
  );
  failIf(
    failures,
    linking.criticalStationFailures.length > 0,
    'CRITICAL_STATION_FAILURE',
    `${linking.criticalStationFailures.length} critical station complex(es) failed.`,
    linking.criticalStationFailures,
  );
  failIf(
    failures,
    linking.p0IsolatedOrPruned.length > 0,
    'P0_LINKING_FAILURE',
    'A P0 stop is isolated or pruned.',
    linking.p0IsolatedOrPruned,
  );
  const criticalIds = new Set(
    linking.criticalStations.map((station) => `tokyo:${station.id}`),
  );
  const missingCritical = config.criticalStationComplexIds.filter(
    (id) => !criticalIds.has(id),
  );
  failIf(
    failures,
    missingCritical.length > 0,
    'CRITICAL_STATION_NOT_MEASURED',
    `Critical stations missing from metrics: ${missingCritical.join(', ')}.`,
  );
  failIf(
    failures,
    transfer.smokeTests.total !== config.requiredRegressionCaseCount ||
      transfer.smokeTests.total < config.minimumRegressionCaseCount,
    'REGRESSION_CASE_COUNT_INVALID',
    `Regression case count ${transfer.smokeTests.total} does not equal ${config.requiredRegressionCaseCount}.`,
  );
  failIf(
    failures,
    transfer.smokeTests.passRate < config.smokePassRateMin,
    'REGRESSION_FAILED',
    `Regression pass rate ${transfer.smokeTests.passRate} is below ${config.smokePassRateMin}.`,
  );
  failIf(
    failures,
    transfer.transferRegression.total <
      config.minimumTransferRegressionCaseCount ||
      transfer.transferRegression.passRate <
        config.transferRegressionPassRateMin,
    'TRANSFER_REGRESSION_FAILED',
    'Transfer regression count or pass rate is below policy.',
  );
  failIf(
    failures,
    transfer.complexWalkValidation?.status !== 'PASS',
    'STATION_COMPLEX_WALK_FAILED',
    'A reviewed station-complex walking regression failed.',
  );
  if (baseline?.metrics) {
    compareLinkingToBaseline(
      failures,
      linking,
      baseline.metrics.linking,
      config,
    );
    comparePerformanceToBaseline(
      failures,
      performance,
      baseline.metrics.performance,
      config,
    );
    failIf(
      failures,
      transfer.crossFeedTransferStationCount <
        baseline.metrics.transfer.crossFeedTransferStationCount,
      'CROSS_FEED_COMPLEX_COUNT_REGRESSION',
      `Cross-feed complex count ${transfer.crossFeedTransferStationCount} is below baseline ${baseline.metrics.transfer.crossFeedTransferStationCount}.`,
    );
  }
  for (const feed of coverage.feedStatuses) {
    if (feed.status === 'VERIFIED_WITH_WARNING') {
      warnings.push({
        code: 'FEED_VERIFIED_WITH_WARNING',
        message: `${feed.feedId} passed with warnings.`,
        details: feed,
      });
    }
  }
  return {
    schemaVersion: '1.0',
    evaluatedAt: new Date().toISOString(),
    buildId: manifest.buildId,
    baselineBuildId: baseline?.buildId ?? null,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    candidateApprovalAllowed: failures.length === 0,
    failures,
    warnings,
    deltas: buildDeltas(linking, transfer, performance, baseline?.metrics),
    summary: {
      loadedFeedCount: loadedFeeds.size,
      verifiedLineCount: coverage.rows.length - incompleteRows.length,
      totalLineCount: coverage.rows.length,
      regressionPassRate: transfer.smokeTests.passRate,
      transferRegressionPassRate: transfer.transferRegression.passRate,
      isolatedStopRatio: linking.isolatedStopRatio,
      unlinkedTransferRatio: linking.unlinkedTransferRatio,
      prunedStopIslands: linking.prunedStopIslands,
      snappingP95Meters: linking.osmSnappingDistanceMeters.all.p95,
    },
  };
}

function buildDeltas(linking, transfer, performance, baseline) {
  if (!baseline) return {};
  return {
    totalStops: metricDelta(baseline.linking.totalStops, linking.totalStops),
    linkedStops: metricDelta(baseline.linking.linkedStops, linking.linkedStops),
    isolatedStops: metricDelta(
      baseline.linking.isolatedStops,
      linking.isolatedStops,
    ),
    unlinkedTransferStops: metricDelta(
      baseline.linking.unlinkedTransferStops,
      linking.unlinkedTransferStops,
    ),
    prunedStopIslands: metricDelta(
      baseline.linking.prunedStopIslands,
      linking.prunedStopIslands,
    ),
    snappingP95Meters: metricDelta(
      baseline.linking.osmSnappingDistanceMeters.all.p95,
      linking.osmSnappingDistanceMeters.all.p95,
    ),
    crossFeedStationComplexCount: metricDelta(
      baseline.transfer.crossFeedTransferStationCount,
      transfer.crossFeedTransferStationCount,
    ),
    graphBytes: metricDelta(
      baseline.performance.graph.bytes,
      performance.graph.bytes,
    ),
    buildDurationSeconds: metricDelta(
      baseline.performance.build.durationSeconds,
      performance.build.durationSeconds,
    ),
    buildPeakMemoryMiB: metricDelta(
      baseline.performance.build.approximatePeakMemoryMiB,
      performance.build.approximatePeakMemoryMiB,
    ),
    startupDurationSeconds: metricDelta(
      baseline.performance.startup.durationSeconds,
      performance.startup.durationSeconds,
    ),
    startupIdleMemoryMiB: metricDelta(
      baseline.performance.startup.idleMemoryMiB,
      performance.startup.idleMemoryMiB,
    ),
    queryP50Milliseconds: metricDelta(
      baseline.performance.routingQueries.p50Milliseconds,
      performance.routingQueries.p50Milliseconds,
    ),
    queryP95Milliseconds: metricDelta(
      baseline.performance.routingQueries.p95Milliseconds,
      performance.routingQueries.p95Milliseconds,
    ),
    queryMaxMilliseconds: metricDelta(
      baseline.performance.routingQueries.maxMilliseconds,
      performance.routingQueries.maxMilliseconds,
    ),
  };
}

function metricDelta(before, current) {
  return {
    baseline: before ?? null,
    current: current ?? null,
    delta:
      Number.isFinite(before) && Number.isFinite(current)
        ? current - before
        : null,
  };
}

function compareLinkingToBaseline(failures, current, baseline, config) {
  failIf(
    failures,
    current.unlinkedTransferRatio > baseline.unlinkedTransferRatio,
    'UNLINKED_TRANSFER_BASELINE_REGRESSION',
    `Unlinked-transfer ratio ${current.unlinkedTransferRatio} exceeds baseline ${baseline.unlinkedTransferRatio}.`,
  );
  failIf(
    failures,
    current.prunedStopIslands > baseline.prunedStopIslands,
    'PRUNED_ISLAND_BASELINE_REGRESSION',
    `Pruned islands ${current.prunedStopIslands} exceed baseline ${baseline.prunedStopIslands}.`,
  );
  failIf(
    failures,
    exceedsRelative(
      current.osmSnappingDistanceMeters.all.p95,
      baseline.osmSnappingDistanceMeters.all.p95,
      config.maximumBaselineRelativeRegression.snappingP95,
    ),
    'SNAPPING_P95_BASELINE_REGRESSION',
    'Snapping p95 exceeds the approved relative baseline budget.',
  );
  for (const [feedId, baselineFeed] of Object.entries(baseline.perFeed)) {
    const currentFeed = current.perFeed[feedId];
    if (!currentFeed) {
      failures.push({
        code: 'PER_FEED_METRICS_MISSING',
        message: `No current linking metrics for ${feedId}.`,
      });
      continue;
    }
    const currentLinkedRatio = currentFeed.linkedStops / currentFeed.totalStops;
    const baselineLinkedRatio =
      baselineFeed.linkedStops / baselineFeed.totalStops;
    failIf(
      failures,
      currentLinkedRatio < baselineLinkedRatio,
      'PER_FEED_LINKED_RATIO_REGRESSION',
      `${feedId} linked ratio ${currentLinkedRatio} is below baseline ${baselineLinkedRatio}.`,
    );
    const currentUnlinkedRatio =
      currentFeed.unlinkedTransferStops / currentFeed.totalStops;
    const baselineUnlinkedRatio =
      baselineFeed.unlinkedTransferStops / baselineFeed.totalStops;
    failIf(
      failures,
      currentUnlinkedRatio > baselineUnlinkedRatio,
      'PER_FEED_TRANSFER_RATIO_REGRESSION',
      `${feedId} unlinked-transfer ratio ${currentUnlinkedRatio} exceeds baseline ${baselineUnlinkedRatio}.`,
    );
  }
}

function comparePerformanceToBaseline(failures, current, baseline, config) {
  for (const [code, actual, before, budget] of [
    [
      'GRAPH_SIZE_REGRESSION',
      current.graph.bytes,
      baseline.graph.bytes,
      config.maximumBaselineRelativeRegression.graphBytes,
    ],
    [
      'BUILD_DURATION_REGRESSION',
      current.build.durationSeconds,
      baseline.build.durationSeconds,
      config.maximumBaselineRelativeRegression.buildDuration,
    ],
    [
      'STARTUP_DURATION_REGRESSION',
      current.startup.durationSeconds,
      baseline.startup.durationSeconds,
      config.maximumBaselineRelativeRegression.startupDuration,
    ],
    [
      'MEMORY_REGRESSION',
      current.build.approximatePeakMemoryMiB,
      baseline.build.approximatePeakMemoryMiB,
      config.maximumBaselineRelativeRegression.memory,
    ],
    [
      'STARTUP_IDLE_MEMORY_REGRESSION',
      current.startup.idleMemoryMiB,
      baseline.startup.idleMemoryMiB,
      config.maximumBaselineRelativeRegression.memory,
    ],
    [
      'QUERY_P95_REGRESSION',
      current.routingQueries.p95Milliseconds,
      baseline.routingQueries.p95Milliseconds,
      config.maximumBaselineRelativeRegression.queryP95,
    ],
  ]) {
    failIf(
      failures,
      !Number.isFinite(actual) ||
        !Number.isFinite(before) ||
        exceedsRelative(actual, before, budget),
      code,
      `${code} exceeds or lacks its approved baseline measurement.`,
    );
  }
}

function exceedsRelative(actual, baseline, allowedIncrease) {
  return actual > baseline * (1 + allowedIncrease);
}

function failIf(failures, condition, code, message, details = undefined) {
  if (condition)
    failures.push({ code, message, ...(details ? { details } : {}) });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const [
    config,
    manifest,
    sourceChange,
    coverage,
    linking,
    transfer,
    performance,
    baseline,
  ] = await Promise.all([
    readJson(resolveRepositoryPath(options.config)),
    readJson(`${buildRoot}/manifests/build-manifest.json`),
    readJson(`${buildRoot}/quality/source-change.json`),
    readJson(`${buildRoot}/quality/coverage.json`),
    readJson(`${buildRoot}/quality/linking-quality.json`),
    readJson(`${buildRoot}/quality/transfer-quality.json`),
    readJson(`${buildRoot}/quality/performance-metrics.json`),
    readJson(resolveRepositoryPath(options.baseline)),
  ]);
  const result = evaluateProductionReadiness(
    { manifest, sourceChange, coverage, linking, transfer, performance },
    config,
    baseline,
  );
  const output = `${buildRoot}/quality/gate-result.json`;
  await mkdir(dirname(output), { recursive: true });
  await Promise.all([
    writeFile(output, `${JSON.stringify(result, null, 2)}\n`),
    writeFile(
      `${buildRoot}/quality/regression-report.md`,
      renderRegressionReport(result),
    ),
    writeFile(
      `${buildRoot}/quality/baseline-diff.md`,
      renderBaselineDiff(result),
    ),
  ]);
  manifest.qualityGate = {
    status: result.status,
    baselineBuildId: result.baselineBuildId,
    evaluatedAt: result.evaluatedAt,
    failureCount: result.failures.length,
    warningCount: result.warnings.length,
    candidateApprovalAllowed: result.candidateApprovalAllowed,
    coveragePath: 'quality/coverage-report.md',
    sourceChangePath: 'quality/source-change.json',
    performancePath: 'quality/performance-metrics.json',
    linkingQualityPath: 'quality/linking-quality.json',
    transferQualityPath: 'quality/transfer-quality.json',
    resultPath: 'quality/gate-result.json',
    regressionReportPath: 'quality/regression-report.md',
    baselineDiffPath: 'quality/baseline-diff.md',
  };
  await writeFile(
    `${buildRoot}/manifests/build-manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ output, ...result }, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

function renderRegressionReport(result) {
  const list = (items) =>
    items.length === 0
      ? '- None'
      : items.map((item) => `- **${item.code}**: ${item.message}`).join('\n');
  return `# Tokyo rail production quality gate

- Build: \`${result.buildId}\`
- Baseline: \`${result.baselineBuildId}\`
- Status: **${result.status}**
- Candidate approval allowed: **${result.candidateApprovalAllowed}**
- Loaded feeds: ${result.summary.loadedFeedCount}
- Verified lines: ${result.summary.verifiedLineCount}/${result.summary.totalLineCount}
- Regression pass rate: ${result.summary.regressionPassRate}
- Transfer regression pass rate: ${result.summary.transferRegressionPassRate}

## Failures

${list(result.failures)}

## Warnings

${list(result.warnings)}
`;
}

function renderBaselineDiff(result) {
  const rows = Object.entries(result.deltas).map(
    ([metric, value]) =>
      `| ${metric} | ${value.baseline ?? '—'} | ${value.current ?? '—'} | ${value.delta ?? '—'} |`,
  );
  return `# Tokyo rail production baseline diff

- Candidate: \`${result.buildId}\`
- Baseline: \`${result.baselineBuildId}\`
- Gate: **${result.status}**

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
${rows.join('\n')}
`;
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
    config: 'otp/config/tokyo-rail-production-gate.json',
    baseline: 'otp/baselines/tokyo-rail-production.json',
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
