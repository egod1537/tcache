#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { round } from './lib.mjs';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const transferDir = `${buildRoot}/diagnostics/transfers`;
  const [
    map,
    rules,
    regression,
    walkValidation,
    linking,
    linkingComparison,
    qualityBaseline,
    smoke,
  ] = await Promise.all([
    readJson(`${transferDir}/station-complex-map.json`),
    readJson(`${transferDir}/transfer-rules.json`),
    readJson(`${transferDir}/transfer-regression-cases.json`),
    readJson(`${transferDir}/complex-walk-validation.json`),
    readJson(`${buildRoot}/diagnostics/linking/otp-linking-issues.json`),
    readOptionalJson(
      `${buildRoot}/diagnostics/linking/before-after-metrics.json`,
    ),
    readJson(
      resolveRepositoryPath('otp/baselines/tokyo-linking-transfer.json'),
    ),
    readJson(`${buildRoot}/smoke-tests/latest/summary.json`),
  ]);
  const walkByComplex = new Map();
  for (const result of walkValidation.results) {
    const items = walkByComplex.get(result.stationComplexId) ?? [];
    items.push(result);
    walkByComplex.set(result.stationComplexId, items);
  }
  const regressionByComplex = new Map();
  for (const result of regression.results.filter(
    (item) => item.status === 'PASS',
  )) {
    const items = regressionByComplex.get(result.expectedComplexId) ?? [];
    items.push(result.id);
    regressionByComplex.set(result.expectedComplexId, items);
  }
  map.complexes = map.complexes.map((complex) => {
    const walks = walkByComplex.get(complex.stationComplexId) ?? [];
    return {
      ...complex,
      routingValidation: {
        status:
          walks.length > 0 && walks.every((item) => item.status === 'PASS')
            ? 'PASS'
            : 'NOT_VALIDATED',
        pedestrianPairCount: walks.length,
        maximumWalkingTimeSeconds:
          walks.length > 0
            ? Math.max(...walks.map((item) => item.durationSeconds))
            : null,
        maximumWalkingDistanceMeters:
          walks.length > 0
            ? Math.max(...walks.map((item) => item.distanceMeters))
            : null,
        regressionCaseIds:
          regressionByComplex.get(complex.stationComplexId) ?? [],
      },
    };
  });
  map.summary.walkValidatedComplexes = map.complexes.filter(
    (complex) => complex.routingValidation.status === 'PASS',
  ).length;
  map.summary.odRegressionVerifiedComplexes =
    regression.metrics.verifiedStationComplexes;
  const transferWarnings = linking.issues.filter((issue) =>
    issue.warningTypes.includes('UNLINKED_TRANSFER'),
  );
  const actionableBeforeEvidence = transferWarnings.filter((issue) =>
    ['P0', 'P1'].includes(issue.priority),
  );
  const pedestrianVerifiedMembers = new Set(
    map.complexes
      .filter((complex) => complex.routingValidation.status === 'PASS')
      .flatMap((complex) =>
        complex.members.map((member) => `${member.feedId}::${member.stopId}`),
      ),
  );
  const resolvedByEvidence = actionableBeforeEvidence.filter((issue) =>
    pedestrianVerifiedMembers.has(`${issue.feedId}::${issue.stopId}`),
  );
  const actionableAfterEvidence = actionableBeforeEvidence.filter(
    (issue) => !resolvedByEvidence.includes(issue),
  );
  const before = linkingComparison?.importWarnings.before ?? {
    buildId: qualityBaseline.baselineBuildId,
    stopsNotLinkedForTransfers:
      qualityBaseline.metrics.linking.unlinkedTransferStops,
  };
  const after = linkingComparison?.importWarnings.after ?? {
    buildId: linking.buildId,
    stopsNotLinkedForTransfers:
      linking.summary.warningEvents.UNLINKED_TRANSFER ?? 0,
  };
  const metrics = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    buildId: after.buildId,
    status:
      regression.status === 'PASS' &&
      walkValidation.status === 'PASS' &&
      smoke.status === 'PASS' &&
      smoke.passed === 11 &&
      actionableAfterEvidence.length === 0 &&
      rules.explicitRules.length === 0
        ? 'PASS'
        : 'FAIL',
    importWarnings: {
      baselineUnlinkedTransferStops: before.stopsNotLinkedForTransfers,
      currentUnlinkedTransferStops: after.stopsNotLinkedForTransfers,
      reductionCount:
        before.stopsNotLinkedForTransfers - after.stopsNotLinkedForTransfers,
      reductionPercent:
        before.stopsNotLinkedForTransfers === 0
          ? 0
          : round(
              ((before.stopsNotLinkedForTransfers -
                after.stopsNotLinkedForTransfers) /
                before.stopsNotLinkedForTransfers) *
                100,
              1,
            ),
      currentClassification: countBy(
        transferWarnings,
        (issue) => issue.suspectedRootCause,
      ),
      actionableP0P1BeforeStationEvidence: actionableBeforeEvidence.length,
      resolvedByPedestrianEvidence: resolvedByEvidence.length,
      actionableP0P1AfterStationEvidence: actionableAfterEvidence.length,
    },
    stationComplexes: {
      reviewed: map.summary.reviewedComplexes,
      crossFeed: map.summary.crossFeedComplexes,
      walkValidated: map.summary.walkValidatedComplexes,
      odRegressionVerified: regression.metrics.verifiedStationComplexes,
      automaticCandidatesNotMerged:
        map.summary.automaticCandidatesRequiringReview,
    },
    transferPaths: {
      averageOdTransferWalkingTimeSeconds:
        regression.metrics.averageTransferWalkingTimeSeconds,
      averageComplexWalkingTimeSeconds:
        walkValidation.metrics.averageWalkingTimeSeconds,
      abnormalZeroSecondTransfers:
        regression.metrics.abnormalZeroSecondTransfers +
        walkValidation.metrics.abnormalZeroSecondPaths,
      stationInternalTransfersOver15Minutes:
        regression.metrics.stationInternalTransfersOver15Minutes +
        walkValidation.metrics.pathsOver15Minutes,
      targetedFindings: walkValidation.targetedFindings,
    },
    rules: {
      explicitTransferRules: rules.explicitRules.length,
      sourceGtfsModified: rules.policy.sourceGtfsModified,
      stopConsolidationEnabled: rules.policy.stopConsolidationEnabled,
    },
    regressions: {
      transferCases: regression.metrics.testedCases,
      transferPassed: regression.passed,
      transferFailed: regression.failed,
      existingSmokePassed: smoke.passed,
      existingSmokeFailed: smoke.failed,
    },
  };
  await Promise.all([
    writeFile(
      `${transferDir}/station-complex-map.json`,
      `${JSON.stringify(map, null, 2)}\n`,
    ),
    writeFile(
      `${transferDir}/transfer-quality-metrics.json`,
      `${JSON.stringify(metrics, null, 2)}\n`,
    ),
    writeFile(
      `${transferDir}/transfer-quality-report.md`,
      buildMarkdown(metrics, regression),
    ),
  ]);
  const manifestPath = `${buildRoot}/manifests/build-manifest.json`;
  const manifest = await readJson(manifestPath);
  manifest.transferQuality = {
    status: metrics.status,
    stationComplexMapPath: 'diagnostics/transfers/station-complex-map.json',
    transferRulesPath: 'diagnostics/transfers/transfer-rules.json',
    regressionPath: 'diagnostics/transfers/transfer-regression-cases.json',
    walkValidationPath: 'diagnostics/transfers/complex-walk-validation.json',
    reportPath: 'diagnostics/transfers/transfer-quality-report.md',
    metricsPath: 'diagnostics/transfers/transfer-quality-metrics.json',
    reviewedComplexes: metrics.stationComplexes.reviewed,
    crossFeedComplexes: metrics.stationComplexes.crossFeed,
    transferRegression: `${regression.passed}/${regression.metrics.testedCases}`,
    existingSmokeRegression: `${smoke.passed}/11`,
    explicitTransferRules: metrics.rules.explicitTransferRules,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ report: `${transferDir}/transfer-quality-report.md`, ...metrics }, null, 2)}\n`,
  );
  if (metrics.status !== 'PASS') process.exitCode = 1;
}

function buildMarkdown(metrics, regression) {
  const categoryRows = Object.entries(regression.categoryCounts).map(
    ([category, counts]) =>
      `| ${category} | ${counts.passed} | ${counts.total} | ${counts.passed === counts.total ? 'PASS' : 'FAIL'} |`,
  );
  const warningRows = Object.entries(
    metrics.importWarnings.currentClassification,
  )
    .sort((left, right) => right[1] - left[1])
    .map(([cause, count]) => `| ${cause} | ${count} |`);
  return `# Tokyo OTP transfer / station-complex quality report

- Build: \`${metrics.buildId}\`
- Status: **${metrics.status}**
- Scope: personal education/research only; no external distribution or commercial use.

## Outcome

The comparison baseline has ${metrics.importWarnings.baselineUnlinkedTransferStops}
\`StopNotLinkedForTransfers\` import events; the current build has
${metrics.importWarnings.currentUnlinkedTransferStops}
(${metrics.importWarnings.reductionPercent}% reduction) after the OSM coverage/linking work.
This phase did not suppress the remaining events with a larger threshold. It
classified them and verified actual pedestrian and transit behavior.

- Reviewed station complexes: ${metrics.stationComplexes.reviewed} (${metrics.stationComplexes.crossFeed} cross-feed)
- Pedestrian-validated complexes: ${metrics.stationComplexes.walkValidated}
- Transfer OD cases: ${metrics.regressions.transferPassed}/${metrics.regressions.transferCases} PASS
- Existing integrated smoke: ${metrics.regressions.existingSmokePassed}/11 PASS
- Explicit/synthetic transfer rules added: ${metrics.rules.explicitTransferRules}
- Source GTFS modified: ${metrics.rules.sourceGtfsModified}

## Remaining import-warning classification

| Classification | Events |
| --- | ---: |
${warningRows.join('\n')}

Of the ${metrics.importWarnings.currentUnlinkedTransferStops} raw events,
${metrics.importWarnings.currentClassification.EXPECTED_WITHIN_PARENT_STATION ?? 0}
are sibling platforms already grouped by the same GTFS \`parent_station\`,
${metrics.importWarnings.currentClassification.NO_NEARBY_TRANSFER_PEER ?? 0}
have no nearby transfer peer, and
${metrics.importWarnings.currentClassification.ISLAND_ROAD ?? 0} belong to
separately tracked small street islands. Fragmented-station warnings are only
resolved when the stop belongs to a reviewed complex whose actual OTP pedestrian
pair validation passes; a shared name or straight-line distance is insufficient.
These classifications are rechecked by the machine-readable metrics.

Pedestrian evidence resolved
${metrics.importWarnings.resolvedByPedestrianEvidence} actionable transfer
warning(s) without inventing a zero-second transfer. Raw OTP import events are
${metrics.importWarnings.currentUnlinkedTransferStops};
actionable P0/P1 transfer findings after evidence review are
${metrics.importWarnings.actionableP0P1AfterStationEvidence}.

## Transfer-path metrics

- Average walking time for the selected 20 OD transfers: ${metrics.transferPaths.averageOdTransferWalkingTimeSeconds}s
- Average direct walk across reviewed member pairs: ${metrics.transferPaths.averageComplexWalkingTimeSeconds}s
- Abnormal zero-second transfer/path count: ${metrics.transferPaths.abnormalZeroSecondTransfers}
- Station-internal paths over 15 minutes: ${metrics.transferPaths.stationInternalTransfersOver15Minutes}

| OD category | Passed | Total | Status |
| --- | ---: | ---: | --- |
${categoryRows.join('\n')}

Each passing OD asserts the required feed order, the expected reviewed station
complex, a reasonable transfer count, positive/ordered times, a real WALK leg
between different stops, and no station-internal walk above 15 minutes.

## Rule decision

No \`transfers.txt\`, OTP stop consolidation, coordinate override, or minimum
transfer time was added in this phase. The current OSM pedestrian graph already
supplies the verified paths. GTFS transfer rules are feed-scoped, while OTP stop
consolidation can affect realtime, fares, and transfer semantics; neither is a
safe substitute for the working street paths here.

Automatic name/distance candidates (${metrics.stationComplexes.automaticCandidatesNotMerged})
remain \`REVIEW_REQUIRED\` and are inactive. Names alone never create a complex.

## Reproduction

Run \`otp/scripts/check-transfer-quality.sh\` while the integrated OTP graph is
available. Machine-readable requests, responses, map evidence, rules, and
metrics are stored beside this report.
`;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
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

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = { buildRoot: 'otp/data/japan/tokyo/builds/latest' };
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
