import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateProductionReadiness } from '../evaluate-production-readiness.mjs';

const feedIds = Array.from({ length: 12 }, (_, index) => `feed-${index}`);
const criticalIds = ['tokyo:tokyo', 'tokyo:shinjuku'];
const config = {
  requiredFeedCount: 12,
  requiredRegressionCaseCount: 148,
  minimumRegressionCaseCount: 100,
  minimumTransferRegressionCaseCount: 20,
  validatorErrorsMax: 0,
  isolatedStopRatioMax: 0,
  snappingP95HardMaxMeters: 15,
  smokePassRateMin: 1,
  transferRegressionPassRateMin: 1,
  maximumBaselineRelativeRegression: {
    snappingP95: 0.25,
    graphBytes: 0.5,
    buildDuration: 0.5,
    startupDuration: 0.5,
    memory: 0.5,
    queryP95: 0.5,
  },
  criticalStationComplexIds: criticalIds,
};

test('approved 12-feed metrics pass the final promotion gate', () => {
  const result = evaluateProductionReadiness(inputs(), config, baseline());
  assert.equal(result.status, 'PASS');
  assert.equal(result.candidateApprovalAllowed, true);
  assert.deepEqual(result.failures, []);
});

test('source, coverage, regression, and critical-station failures block promotion', () => {
  const current = inputs();
  current.sourceChange.status = 'FAIL';
  current.coverage.rows[0].status = 'PARTIAL';
  current.linking.criticalStationFailures.push({ id: 'tokyo' });
  current.transfer.smokeTests.failed = 1;
  current.transfer.smokeTests.passRate = 147 / 148;
  const result = evaluateProductionReadiness(current, config, baseline());
  const codes = result.failures.map((failure) => failure.code);
  assert.ok(codes.includes('SOURCE_CHANGE_GATE_FAILED'));
  assert.ok(codes.includes('COVERAGE_INCOMPLETE'));
  assert.ok(codes.includes('CRITICAL_STATION_FAILURE'));
  assert.ok(codes.includes('REGRESSION_FAILED'));
  assert.equal(result.candidateApprovalAllowed, false);
});

test('missing approved baseline and performance regression block promotion', () => {
  const current = inputs();
  current.performance.routingQueries.p95Milliseconds = 200;
  const old = baseline();
  old.reviewStatus = 'PENDING';
  const result = evaluateProductionReadiness(current, config, old);
  assert.ok(
    result.failures.some(
      (failure) => failure.code === 'PRODUCTION_BASELINE_NOT_APPROVED',
    ),
  );
  assert.ok(
    result.failures.some((failure) => failure.code === 'QUERY_P95_REGRESSION'),
  );
});

function inputs() {
  const perFeed = Object.fromEntries(
    feedIds.map((feedId) => [
      feedId,
      {
        totalStops: 10,
        linkedStops: 10,
        unlinkedTransferStops: 0,
      },
    ]),
  );
  return {
    manifest: {
      buildId: 'candidate',
      inputs: feedIds.map((feedId) => ({ feedId })),
    },
    sourceChange: { status: 'PASS', failures: [] },
    coverage: {
      loadedFeedCount: 12,
      rows: feedIds.map((feedId) => ({ feedId, status: 'VERIFIED' })),
      feedStatuses: feedIds.map((feedId) => ({
        feedId,
        status: 'VERIFIED',
      })),
    },
    linking: {
      validatorErrors: 0,
      isolatedStopRatio: 0,
      unlinkedTransferRatio: 0,
      prunedStopIslands: 0,
      criticalStationFailures: [],
      p0IsolatedOrPruned: [],
      criticalStations: criticalIds.map((id) => ({
        id: id.replace(/^tokyo:/u, ''),
      })),
      osmSnappingDistanceMeters: { all: { p95: 5 } },
      perFeed,
    },
    transfer: {
      smokeTests: { total: 148, passed: 148, failed: 0, passRate: 1 },
      transferRegression: { total: 20, passed: 20, failed: 0, passRate: 1 },
      complexWalkValidation: { status: 'PASS' },
      crossFeedTransferStationCount: 16,
    },
    performance: performance(),
  };
}

function baseline() {
  return {
    reviewStatus: 'APPROVED',
    buildId: 'baseline',
    metrics: {
      linking: {
        unlinkedTransferRatio: 0,
        prunedStopIslands: 0,
        osmSnappingDistanceMeters: { all: { p95: 5 } },
        perFeed: Object.fromEntries(
          feedIds.map((feedId) => [
            feedId,
            {
              totalStops: 10,
              linkedStops: 10,
              unlinkedTransferStops: 0,
            },
          ]),
        ),
      },
      performance: performance(),
      transfer: { crossFeedTransferStationCount: 16 },
    },
  };
}

function performance() {
  return {
    graph: { bytes: 100 },
    build: { durationSeconds: 10, approximatePeakMemoryMiB: 100 },
    startup: { durationSeconds: 5, idleMemoryMiB: 50 },
    routingQueries: {
      p50Milliseconds: 50,
      p95Milliseconds: 100,
      maxMilliseconds: 150,
    },
  };
}
