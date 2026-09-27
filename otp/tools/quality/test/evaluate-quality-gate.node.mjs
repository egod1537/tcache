import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { buildQualityMetrics } from '../collect-quality.mjs';
import { evaluateGate } from '../evaluate-quality-gate.mjs';

const repositoryRoot = new URL('../../../..', import.meta.url);
const [baseline, config] = await Promise.all([
  readJson(
    new URL('otp/baselines/tokyo-linking-transfer.json', repositoryRoot),
  ),
  readJson(
    new URL('otp/config/linking-transfer-quality-gate.json', repositoryRoot),
  ),
]);

test('approved Metro scope passes with documented P3 growth warnings', () => {
  const current = currentMetrics();
  const result = evaluateGate(current, baseline, config);
  assert.equal(result.status, 'PASS');
  assert.equal(result.candidateApprovalAllowed, true);
  assert.deepEqual(result.failures, []);
  assert.ok(
    result.warnings.some(
      (item) => item.code === 'UNLINKED_TRANSFER_RATIO_INCREASED',
    ),
  );
  assert.ok(
    result.warnings.some((item) => item.code === 'P3_WARNING_INCREASED'),
  );
});

test('one required OD failure blocks candidate approval', () => {
  const current = currentMetrics();
  current.transfer.smokeTests = {
    ...current.transfer.smokeTests,
    passed: 50,
    failed: 1,
    total: 51,
    passRate: 50 / 51,
  };
  const result = evaluateGate(current, baseline, config);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.candidateApprovalAllowed, false);
  assert.ok(result.failures.some((item) => item.code === 'REQUIRED_OD_FAILED'));
});

test('critical station warning and P0 linking issue are hard failures', () => {
  const current = currentMetrics();
  current.linking.criticalStationFailures = [{ name: 'Tokyo', members: [] }];
  current.linking.p0IsolatedOrPruned = [{ feedId: 'feed', stopId: 'stop' }];
  const result = evaluateGate(current, baseline, config);
  assert.ok(
    result.failures.some((item) => item.code === 'CRITICAL_STATION_UNLINKED'),
  );
  assert.ok(result.failures.some((item) => item.code === 'P0_LINKING_FAILURE'));
});

test('a ratio or p95 regression inside hard budgets is reported as warning', () => {
  const current = currentMetrics();
  current.linking.unlinkedTransferStops += 1;
  current.linking.unlinkedTransferRatio =
    current.linking.unlinkedTransferStops / current.linking.totalStops;
  current.linking.perFeed['jp-tokyo-toei-bus'].unlinkedTransferStops += 1;
  current.linking.osmSnappingDistanceMeters.all.p95 = 9;
  const result = evaluateGate(current, baseline, config);
  assert.equal(result.status, 'PASS');
  assert.ok(
    result.warnings.some(
      (item) => item.code === 'UNLINKED_TRANSFER_RATIO_INCREASED',
    ),
  );
  assert.ok(
    result.warnings.some((item) => item.code === 'SNAPPING_P95_REGRESSION'),
  );
});

test('quality collector calculates ratios and critical station state', () => {
  const metrics = buildQualityMetrics(
    {
      manifest: {
        buildId: 'build',
        preflight: { feeds: [{ errorCount: 0 }] },
        smokeTests: { summaryPath: 'smoke.json' },
      },
      linking: {
        summary: {
          stopInventory: {
            totalStops: 10,
            linkedStops: 9,
            stopKeys: ['feed::critical'],
            byFeed: { feed: { totalStops: 10, linkedStops: 9 } },
          },
          warningEvents: { ISOLATED_STOP: 1, UNLINKED_TRANSFER: 2 },
          warningEventsByFeed: {
            ISOLATED_STOP: { feed: 1 },
            UNLINKED_TRANSFER: { feed: 2 },
          },
          osmSnappingDistanceMeters: {
            all: { p50: 1, p95: 2, max: 3 },
            byFeed: { feed: { p50: 1, p95: 2, max: 3 } },
          },
          byPriority: { P0: 1 },
        },
        issues: [
          {
            feedId: 'feed',
            stopId: 'critical',
            warningTypes: ['ISOLATED_STOP'],
            priority: 'P0',
          },
        ],
      },
      smoke: { status: 'PASS', passed: 1, failed: 0 },
      regression: {
        status: 'PASS',
        passed: 1,
        failed: 0,
        metrics: {
          verifiedStationComplexes: 1,
          averageTransferWalkingTimeSeconds: 10,
          abnormalZeroSecondTransfers: 0,
          stationInternalTransfersOver15Minutes: 0,
        },
      },
      transfer: {
        status: 'PASS',
        rules: { explicitTransferRules: 0 },
      },
      walkValidation: {
        status: 'PASS',
        passed: 1,
        failed: 0,
        metrics: { validatedComplexes: 1 },
      },
      stationMap: {
        summary: { crossFeedComplexes: 1, walkValidatedComplexes: 1 },
      },
    },
    {
      metricDefinitions: {},
      criticalStations: [
        {
          id: 'critical',
          name: 'Critical',
          members: [
            { feedId: 'feed', stopId: 'critical' },
            { feedId: 'feed', stopId: 'missing' },
          ],
        },
      ],
    },
  );
  assert.equal(metrics.linkingQuality.isolatedStopRatio, 0.1);
  assert.equal(metrics.linkingQuality.unlinkedTransferRatio, 0.2);
  assert.equal(metrics.linkingQuality.criticalStationFailures.length, 1);
  assert.equal(
    metrics.linkingQuality.criticalStations[0].members[0].present,
    true,
  );
  assert.equal(
    metrics.linkingQuality.criticalStations[0].members[1].present,
    false,
  );
});

function currentMetrics() {
  const current = {
    linking: clone(baseline.metrics.linking),
    transfer: clone(baseline.metrics.transfer),
  };
  current.linking.totalStops = 4134;
  current.linking.linkedStops = 4091;
  current.linking.unlinkedTransferStops = 162;
  current.linking.unlinkedTransferRatio = 162 / 4134;
  current.linking.osmSnappingDistanceMeters.all.p95 = 6.7;
  current.linking.warningPriorities.P3 = 154;
  current.linking.perFeed['jp-tokyo-jr-east'] = {
    totalStops: 110,
    linkedStops: 110,
    linkingFailureStops: 0,
    isolatedStops: 0,
    unlinkedTransferStops: 32,
    prunedStopIslands: 0,
    osmSnappingDistanceMeters: {
      population: 110,
      measuredCount: 110,
      missingCount: 0,
      p50: 0,
      p95: 2.3,
      max: 3.5,
    },
  };
  current.linking.perFeed['jp-tokyo-metro'] = {
    totalStops: 185,
    linkedStops: 185,
    linkingFailureStops: 0,
    isolatedStops: 0,
    unlinkedTransferStops: 0,
    prunedStopIslands: 0,
    osmSnappingDistanceMeters: {
      population: 185,
      measuredCount: 185,
      missingCount: 0,
      p50: 1.1,
      p95: 7.5,
      max: 14,
    },
  };
  current.transfer.smokeTests = {
    status: 'PASS',
    passed: 51,
    failed: 0,
    total: 51,
    passRate: 1,
  };
  current.transfer.crossFeedTransferStationCount = 21;
  current.transfer.complexWalkValidation = {
    ...current.transfer.complexWalkValidation,
    passed: 37,
    failed: 0,
    total: 37,
    passRate: 1,
  };
  return current;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
