#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function buildQualityMetrics(inputs, gateConfig) {
  const {
    manifest,
    linking,
    smoke,
    regression,
    transfer,
    walkValidation,
    stationMap,
  } = inputs;
  const totalStops = linking.summary.stopInventory.totalStops;
  const warningEvents = linking.summary.warningEvents;
  const isolatedStops = warningEvents.ISOLATED_STOP ?? 0;
  const unlinkedTransferStops = warningEvents.UNLINKED_TRANSFER ?? 0;
  const prunedStopIslands = warningEvents.PRUNED_STOP_ISLAND ?? 0;
  const perFeed = {};
  for (const [feedId, inventory] of Object.entries(
    linking.summary.stopInventory.byFeed,
  )) {
    perFeed[feedId] = {
      ...inventory,
      isolatedStops:
        linking.summary.warningEventsByFeed.ISOLATED_STOP?.[feedId] ?? 0,
      unlinkedTransferStops:
        linking.summary.warningEventsByFeed.UNLINKED_TRANSFER?.[feedId] ?? 0,
      prunedStopIslands:
        linking.summary.warningEventsByFeed.PRUNED_STOP_ISLAND?.[feedId] ?? 0,
      osmSnappingDistanceMeters:
        linking.summary.osmSnappingDistanceMeters.byFeed[feedId],
    };
  }
  const issueByStop = new Map(
    linking.issues.map((issue) => [`${issue.feedId}::${issue.stopId}`, issue]),
  );
  const operationalStopKeys = new Set(
    linking.summary.stopInventory.stopKeys ?? [],
  );
  const criticalStations = gateConfig.criticalStations.map((station) => {
    const members = station.members.map((configuredMember) => {
      const member = resolveCriticalMember(configuredMember, stationMap);
      const stopKey = `${member.feedId}::${member.stopId}`;
      const issue = issueByStop.get(stopKey);
      const warnings = issue?.warningTypes ?? [];
      const present = operationalStopKeys.has(stopKey);
      return {
        ...member,
        present,
        warningTypes: warnings,
        priority: issue?.priority ?? null,
        status:
          !present ||
          warnings.some((warning) =>
            [
              'ISOLATED_STOP',
              'UNLINKED_TRANSFER',
              'PRUNED_STOP_ISLAND',
            ].includes(warning),
          )
            ? 'FAIL'
            : 'PASS',
      };
    });
    return {
      id: station.id,
      name: station.name,
      status: members.every((member) => member.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
      members,
    };
  });
  const validatorErrors = manifest.preflight.feeds.reduce(
    (sum, feed) => sum + Number(feed.errorCount ?? 0),
    0,
  );
  const p0IsolatedOrPruned = linking.issues
    .filter(
      (issue) =>
        issue.priority === 'P0' &&
        issue.warningTypes.some((warning) =>
          ['ISOLATED_STOP', 'PRUNED_STOP_ISLAND'].includes(warning),
        ),
    )
    .map((issue) => ({
      feedId: issue.feedId,
      stopId: issue.stopId,
      stopName: issue.stopName,
      warningTypes: issue.warningTypes,
      suspectedRootCause: issue.suspectedRootCause,
    }));
  const linkingQuality = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    buildId: manifest.buildId,
    definitions: gateConfig.metricDefinitions,
    totalStops,
    linkedStops: linking.summary.stopInventory.linkedStops,
    linkedStopsByFeed: Object.fromEntries(
      Object.entries(perFeed).map(([feedId, metrics]) => [
        feedId,
        metrics.linkedStops,
      ]),
    ),
    isolatedStops,
    isolatedStopRatio: ratio(isolatedStops, totalStops),
    unlinkedTransferStops,
    unlinkedTransferRatio: ratio(unlinkedTransferStops, totalStops),
    prunedStopIslands,
    osmSnappingDistanceMeters: linking.summary.osmSnappingDistanceMeters,
    warningPriorities: linking.summary.byPriority,
    perFeed,
    criticalStations,
    criticalStationFailures: criticalStations.filter(
      (station) => station.status === 'FAIL',
    ),
    p0IsolatedOrPruned,
    validatorErrors,
    sourcePaths: {
      linkingDiagnosis: 'diagnostics/linking/otp-linking-issues.json',
      preflight: 'manifests/preflight.json',
    },
  };
  const transferQuality = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    buildId: manifest.buildId,
    crossFeedTransferStationCount: stationMap.summary.crossFeedComplexes,
    walkValidatedStationComplexCount:
      stationMap.summary.walkValidatedComplexes ??
      walkValidation.metrics.validatedComplexes,
    smokeTests: {
      status: smoke.status,
      passed: smoke.passed,
      failed: smoke.failed,
      total: smoke.passed + smoke.failed,
      passRate: ratio(smoke.passed, smoke.passed + smoke.failed),
    },
    transferRegression: {
      status: regression.status,
      passed: regression.passed,
      failed: regression.failed,
      total: regression.passed + regression.failed,
      passRate: ratio(regression.passed, regression.passed + regression.failed),
      verifiedStationComplexes: regression.metrics.verifiedStationComplexes,
      averageTransferWalkingTimeSeconds:
        regression.metrics.averageTransferWalkingTimeSeconds,
      abnormalZeroSecondTransfers:
        regression.metrics.abnormalZeroSecondTransfers,
      stationInternalTransfersOver15Minutes:
        regression.metrics.stationInternalTransfersOver15Minutes,
    },
    complexWalkValidation: {
      status: walkValidation.status,
      passed: walkValidation.passed,
      failed: walkValidation.failed,
      total: walkValidation.passed + walkValidation.failed,
      passRate: ratio(
        walkValidation.passed,
        walkValidation.passed + walkValidation.failed,
      ),
    },
    transferQualityStatus: transfer.status,
    explicitTransferRules: transfer.rules.explicitTransferRules,
    sourcePaths: {
      smoke: manifest.smokeTests.summaryPath,
      transferRegression:
        'diagnostics/transfers/transfer-regression-cases.json',
      complexWalkValidation:
        'diagnostics/transfers/complex-walk-validation.json',
      stationComplexMap: 'diagnostics/transfers/station-complex-map.json',
    },
  };
  return { linkingQuality, transferQuality };
}

function resolveCriticalMember(member, stationMap) {
  if (member.stopId) return member;
  if (!member.stationCode) {
    throw new Error(`Critical station member has no stopId or stationCode.`);
  }
  const matches = stationMap.complexes
    .flatMap((complex) => complex.members)
    .filter(
      (candidate) =>
        candidate.feedId === member.feedId &&
        candidate.stopCode === member.stationCode,
    );
  if (matches.length !== 1) {
    throw new Error(
      `Critical station code ${member.feedId}:${member.stationCode} resolved to ${matches.length} stops.`,
    );
  }
  return { ...member, stopId: matches[0].stopId };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const outputDir = `${buildRoot}/quality`;
  const gateConfig = await readJson(resolveRepositoryPath(options.config));
  const manifest = await readJson(`${buildRoot}/manifests/build-manifest.json`);
  const smokePath = manifest.smokeTests?.summaryPath;
  if (!smokePath) throw new Error('Build manifest has no smoke summary path.');
  const inputs = {
    manifest,
    linking: await readJson(
      `${buildRoot}/diagnostics/linking/otp-linking-issues.json`,
    ),
    smoke: await readJson(`${buildRoot}/${smokePath}`),
    regression: await readJson(
      `${buildRoot}/diagnostics/transfers/transfer-regression-cases.json`,
    ),
    transfer: await readJson(
      `${buildRoot}/diagnostics/transfers/transfer-quality-metrics.json`,
    ),
    walkValidation: await readJson(
      `${buildRoot}/diagnostics/transfers/complex-walk-validation.json`,
    ),
    stationMap: await readJson(
      `${buildRoot}/diagnostics/transfers/station-complex-map.json`,
    ),
  };
  const metrics = buildQualityMetrics(inputs, gateConfig);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(`${outputDir}/linking-quality.json`, metrics.linkingQuality),
    writeJson(`${outputDir}/transfer-quality.json`, metrics.transferQuality),
  ]);
  process.stdout.write(
    `${JSON.stringify({ outputDir, linking: summary(metrics.linkingQuality), transfer: summary(metrics.transferQuality) }, null, 2)}\n`,
  );
}

function summary(metrics) {
  if ('totalStops' in metrics) {
    return {
      totalStops: metrics.totalStops,
      isolatedStops: metrics.isolatedStops,
      unlinkedTransferStops: metrics.unlinkedTransferStops,
      prunedStopIslands: metrics.prunedStopIslands,
      snappingP95: metrics.osmSnappingDistanceMeters.all.p95,
    };
  }
  return {
    crossFeedTransferStationCount: metrics.crossFeedTransferStationCount,
    smokePassRate: metrics.smokeTests.passRate,
    transferRegressionPassRate: metrics.transferRegression.passRate,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 1e8) / 1e8;
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
