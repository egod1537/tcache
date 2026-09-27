#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function evaluateGate(current, baseline, config) {
  const failures = [];
  const warnings = [];
  const linking = current.linking;
  const transfer = current.transfer;
  const baselineLinking = baseline.metrics.linking;

  failIf(
    failures,
    linking.validatorErrors > config.fail.validatorErrorsMax,
    'GTFS_VALIDATOR_ERROR',
    `Validator errors ${linking.validatorErrors} exceed ${config.fail.validatorErrorsMax}.`,
  );
  failIf(
    failures,
    linking.totalStops < config.fail.totalStopsMin,
    'STOP_COHORT_SHRANK',
    `Operational stop count ${linking.totalStops} is below ${config.fail.totalStopsMin}.`,
  );
  failIf(
    failures,
    linking.osmSnappingDistanceMeters.all.missingCount >
      config.fail.snappingMeasurementsMissingMax,
    'SNAPPING_MEASUREMENT_MISSING',
    `Missing snapping measurements ${linking.osmSnappingDistanceMeters.all.missingCount} exceed ${config.fail.snappingMeasurementsMissingMax}.`,
  );
  failIf(
    failures,
    linking.isolatedStopRatio > config.fail.isolatedStopRatioMax,
    'ISOLATED_RATIO_BUDGET_EXCEEDED',
    `Isolated ratio ${linking.isolatedStopRatio} exceeds ${config.fail.isolatedStopRatioMax}.`,
  );
  failIf(
    failures,
    linking.prunedStopIslands > config.fail.prunedStopIslandsMax,
    'PRUNED_ISLAND_BUDGET_EXCEEDED',
    `Pruned islands ${linking.prunedStopIslands} exceed ${config.fail.prunedStopIslandsMax}.`,
  );
  failIf(
    failures,
    linking.osmSnappingDistanceMeters.all.p95 >
      config.fail.snappingP95MaxMeters,
    'SNAPPING_P95_BUDGET_EXCEEDED',
    `OSM snapping p95 ${linking.osmSnappingDistanceMeters.all.p95}m exceeds ${config.fail.snappingP95MaxMeters}m.`,
  );
  failIf(
    failures,
    transfer.smokeTests.passRate < config.fail.smokePassRateMin,
    'REQUIRED_OD_FAILED',
    `Smoke pass rate ${transfer.smokeTests.passRate} is below ${config.fail.smokePassRateMin}.`,
  );
  failIf(
    failures,
    transfer.smokeTests.total !== config.fail.smokeRequiredCaseCount,
    'REQUIRED_OD_CASE_COUNT_CHANGED',
    `Smoke case count ${transfer.smokeTests.total} does not equal ${config.fail.smokeRequiredCaseCount}.`,
  );
  failIf(
    failures,
    transfer.transferRegression.passRate <
      config.fail.transferRegressionPassRateMin,
    'TRANSFER_REGRESSION_FAILED',
    `Transfer regression pass rate ${transfer.transferRegression.passRate} is below ${config.fail.transferRegressionPassRateMin}.`,
  );
  failIf(
    failures,
    transfer.transferRegression.total !== config.fail.transferRequiredCaseCount,
    'TRANSFER_REGRESSION_CASE_COUNT_CHANGED',
    `Transfer regression case count ${transfer.transferRegression.total} does not equal ${config.fail.transferRequiredCaseCount}.`,
  );
  failIf(
    failures,
    transfer.complexWalkValidation.total !==
      config.fail.complexWalkRequiredCaseCount,
    'COMPLEX_WALK_CASE_COUNT_CHANGED',
    `Station-complex walk case count ${transfer.complexWalkValidation.total} does not equal ${config.fail.complexWalkRequiredCaseCount}.`,
  );
  failIf(
    failures,
    transfer.crossFeedTransferStationCount <
      config.fail.crossFeedTransferStationCountMin,
    'CROSS_FEED_COMPLEX_COUNT_SHRANK',
    `Cross-feed station complex count ${transfer.crossFeedTransferStationCount} is below ${config.fail.crossFeedTransferStationCountMin}.`,
  );
  failIf(
    failures,
    transfer.complexWalkValidation.status !== 'PASS',
    'STATION_COMPLEX_WALK_FAILED',
    'At least one reviewed station-complex walk validation failed.',
  );
  if (config.fail.failOnCriticalStationWarning) {
    for (const station of linking.criticalStationFailures) {
      failures.push({
        code: 'CRITICAL_STATION_UNLINKED',
        message: `${station.name} has missing, isolated, unlinked-transfer, or pruned member stops.`,
        details: station,
      });
    }
  }
  if (config.fail.failOnP0IsolatedOrPruned) {
    for (const issue of linking.p0IsolatedOrPruned) {
      failures.push({
        code: 'P0_LINKING_FAILURE',
        message: `P0 linking failure at ${issue.feedId}:${issue.stopId}.`,
        details: issue,
      });
    }
  }
  for (const [feedId, budget] of Object.entries(config.fail.perFeed)) {
    const metrics = linking.perFeed[feedId];
    if (!metrics) {
      failures.push({
        code: 'MISSING_FEED_METRICS',
        message: `No quality metrics were collected for ${feedId}.`,
      });
      continue;
    }
    for (const [metric, maximum] of [
      ['isolatedStops', budget.isolatedStopsMax],
      ['unlinkedTransferStops', budget.unlinkedTransferStopsMax],
      ['prunedStopIslands', budget.prunedStopIslandsMax],
    ]) {
      failIf(
        failures,
        metrics[metric] > maximum,
        'PER_FEED_BUDGET_EXCEEDED',
        `${feedId} ${metric} ${metrics[metric]} exceeds ${maximum}.`,
        { feedId, metric, actual: metrics[metric], maximum },
      );
    }
    failIf(
      failures,
      metrics.linkedStops < budget.linkedStopsMin,
      'PER_FEED_LINKED_STOP_BUDGET_EXCEEDED',
      `${feedId} linkedStops ${metrics.linkedStops} is below ${budget.linkedStopsMin}.`,
      {
        feedId,
        metric: 'linkedStops',
        actual: metrics.linkedStops,
        minimum: budget.linkedStopsMin,
      },
    );
    failIf(
      failures,
      metrics.osmSnappingDistanceMeters.p95 > budget.snappingP95MaxMeters,
      'PER_FEED_SNAPPING_BUDGET_EXCEEDED',
      `${feedId} snapping p95 ${metrics.osmSnappingDistanceMeters.p95}m exceeds ${budget.snappingP95MaxMeters}m.`,
      {
        feedId,
        metric: 'snappingP95Meters',
        actual: metrics.osmSnappingDistanceMeters.p95,
        maximum: budget.snappingP95MaxMeters,
      },
    );
  }

  warnIf(
    warnings,
    linking.unlinkedTransferRatio >
      baselineLinking.unlinkedTransferRatio +
        config.warn.unlinkedTransferRatioAbsoluteIncrease,
    'UNLINKED_TRANSFER_RATIO_INCREASED',
    `Unlinked-transfer ratio increased from ${baselineLinking.unlinkedTransferRatio} to ${linking.unlinkedTransferRatio}.`,
  );
  const baselineP95 = baselineLinking.osmSnappingDistanceMeters.all.p95;
  const currentP95 = linking.osmSnappingDistanceMeters.all.p95;
  warnIf(
    warnings,
    currentP95 > baselineP95 * (1 + config.warn.snappingP95RelativeIncrease) ||
      currentP95 - baselineP95 > config.warn.snappingP95AbsoluteIncreaseMeters,
    'SNAPPING_P95_REGRESSION',
    `OSM snapping p95 increased from ${baselineP95}m to ${currentP95}m.`,
  );
  for (const [priority, allowedIncrease] of [
    ['P2', config.warn.priorityP2Increase],
    ['P3', config.warn.priorityP3Increase],
  ]) {
    const before = baselineLinking.warningPriorities[priority] ?? 0;
    const after = linking.warningPriorities[priority] ?? 0;
    warnIf(
      warnings,
      after > before + allowedIncrease,
      `${priority}_WARNING_INCREASED`,
      `${priority} warnings increased from ${before} to ${after}.`,
    );
  }

  const deltas = buildDeltas(current, baseline);
  return {
    schemaVersion: '1.0',
    evaluatedAt: new Date().toISOString(),
    buildId: linking.buildId,
    baselineBuildId: baseline.baselineBuildId,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    candidateApprovalAllowed: failures.length === 0,
    failures,
    warnings,
    deltas,
  };
}

function buildDeltas(current, baseline) {
  const now = current.linking;
  const before = baseline.metrics.linking;
  return {
    totalStops: delta(before.totalStops, now.totalStops),
    isolatedStops: delta(before.isolatedStops, now.isolatedStops),
    isolatedStopRatio: delta(before.isolatedStopRatio, now.isolatedStopRatio),
    unlinkedTransferStops: delta(
      before.unlinkedTransferStops,
      now.unlinkedTransferStops,
    ),
    unlinkedTransferRatio: delta(
      before.unlinkedTransferRatio,
      now.unlinkedTransferRatio,
    ),
    prunedStopIslands: delta(before.prunedStopIslands, now.prunedStopIslands),
    snappingP95Meters: delta(
      before.osmSnappingDistanceMeters.all.p95,
      now.osmSnappingDistanceMeters.all.p95,
    ),
    crossFeedTransferStationCount: delta(
      baseline.metrics.transfer.crossFeedTransferStationCount,
      current.transfer.crossFeedTransferStationCount,
    ),
    smokePassRate: delta(
      baseline.metrics.transfer.smokeTests.passRate,
      current.transfer.smokeTests.passRate,
    ),
    transferRegressionPassRate: delta(
      baseline.metrics.transfer.transferRegression.passRate,
      current.transfer.transferRegression.passRate,
    ),
  };
}

function delta(baseline, current) {
  return { baseline, current, delta: round(current - baseline) };
}

function round(value) {
  return Math.round(value * 1e8) / 1e8;
}

function failIf(target, condition, code, message, details) {
  if (condition)
    target.push({ code, message, ...(details ? { details } : {}) });
}

function warnIf(target, condition, code, message) {
  if (condition) target.push({ code, message });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const config = await readJson(resolveRepositoryPath(options.config));
  const baseline = await readJson(
    resolveRepositoryPath(options.baseline ?? config.baselinePath),
  );
  const current = {
    linking: await readJson(`${buildRoot}/quality/linking-quality.json`),
    transfer: await readJson(`${buildRoot}/quality/transfer-quality.json`),
  };
  const result = evaluateGate(current, baseline, config);
  const outputDir = `${buildRoot}/quality`;
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(`${outputDir}/gate-result.json`, result),
    writeFile(
      `${outputDir}/baseline-diff.md`,
      buildBaselineDiff(result),
      'utf8',
    ),
    writeFile(
      `${outputDir}/regression-report.md`,
      buildRegressionReport(result, current),
      'utf8',
    ),
  ]);
  const manifestPath = `${buildRoot}/manifests/build-manifest.json`;
  const manifest = await readJson(manifestPath);
  manifest.qualityGate = {
    status: result.status,
    baselineBuildId: result.baselineBuildId,
    evaluatedAt: result.evaluatedAt,
    failureCount: result.failures.length,
    warningCount: result.warnings.length,
    candidateApprovalAllowed: result.candidateApprovalAllowed,
    linkingQualityPath: 'quality/linking-quality.json',
    transferQualityPath: 'quality/transfer-quality.json',
    resultPath: 'quality/gate-result.json',
    regressionReportPath: 'quality/regression-report.md',
    baselineDiffPath: 'quality/baseline-diff.md',
  };
  await writeJson(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

function buildBaselineDiff(result) {
  const rows = Object.entries(result.deltas).map(
    ([metric, values]) =>
      `| ${metric} | ${values.baseline} | ${values.current} | ${signed(values.delta)} |`,
  );
  return `# Tokyo OTP quality baseline diff

- Candidate: \`${result.buildId}\`
- Baseline: \`${result.baselineBuildId}\`
- Gate: **${result.status}**

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
${rows.join('\n')}

Warnings do not silently change the baseline. A new baseline must be captured explicitly after review.
`;
}

function buildRegressionReport(result, current) {
  const failures = result.failures.length
    ? result.failures
        .map((item) => `- **${item.code}**: ${item.message}`)
        .join('\n')
    : '- None';
  const warnings = result.warnings.length
    ? result.warnings
        .map((item) => `- **${item.code}**: ${item.message}`)
        .join('\n')
    : '- None';
  return `# Tokyo OTP linking / transfer production quality gate

- Build: \`${result.buildId}\`
- Baseline: \`${result.baselineBuildId}\`
- Status: **${result.status}**
- Candidate approval allowed: **${result.candidateApprovalAllowed}**

## Required regressions

- GTFS validator errors: ${current.linking.validatorErrors}
- Existing smoke: ${current.transfer.smokeTests.passed}/${current.transfer.smokeTests.total}
- Transfer regression: ${current.transfer.transferRegression.passed}/${current.transfer.transferRegression.total}
- Station-complex walks: ${current.transfer.complexWalkValidation.passed}/${current.transfer.complexWalkValidation.total}
- Critical station failures: ${current.linking.criticalStationFailures.length}
- P0 isolated/pruned findings: ${current.linking.p0IsolatedOrPruned.length}

## Failures

${failures}

## Warnings

${warnings}

The candidate is promoted only when this gate returns PASS. A failed candidate remains versioned for diagnosis while the previously approved \`latest\` graph is retained.
`;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    config: 'otp/config/linking-transfer-quality-gate.json',
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
