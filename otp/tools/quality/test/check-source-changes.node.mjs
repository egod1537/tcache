import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateSourceChanges } from '../check-source-changes.mjs';

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const registry = {
  registryVersion: 'registry',
  requiredFeedCount: 1,
  feeds: [
    {
      feedId: 'feed',
      operator: 'Operator',
      sourceType: 'official-gtfs',
      adapterVersion: 'adapter/1',
      currentSourceStatus: 'READY',
    },
  ],
};
const policy = {
  maximumSourceAgeHours: 48,
  minimumParseCoverage: 0.95,
  maximumParseCoverageDecrease: 0.02,
  maximumStationCountRelativeChange: 0.05,
  requireApprovedBaseline: true,
  requireReviewForSourceHashChange: true,
  requireExactParserStructureVersion: true,
  validatorErrorsMax: 0,
};
const current = {
  feeds: [
    {
      feedId: 'feed',
      sourceSha256: shaA,
      gtfsSha256: shaA,
      sourceEdition: { observedRawKey: 'edition' },
      gtfsVersion: 'version',
      parserStructureVersion: 'adapter/1',
      stationCount: 100,
      parseCoverage: 1,
      validatorErrorCount: 0,
      collectedAt: '2026-09-27T00:00:00.000Z',
    },
  ],
};
const baseline = {
  baselineId: 'baseline',
  reviewStatus: 'APPROVED',
  feeds: current.feeds.map((feed) => ({ ...feed })),
};
const now = new Date('2026-09-27T12:00:00.000Z');

test('unchanged reviewed source snapshot passes', () => {
  const result = evaluateSourceChanges(
    registry,
    clone(current),
    clone(baseline),
    policy,
    now,
  );
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.failures, []);
  assert.equal(result.feeds[0].sourceAgeHours, 12);
});

test('source hash change requires an approval tied to the previous hash', () => {
  const changed = clone(current);
  changed.feeds[0].sourceSha256 = shaB;
  assert.ok(
    evaluateSourceChanges(
      registry,
      changed,
      baseline,
      policy,
      now,
    ).failures.some((item) => item.code === 'SOURCE_CHANGE_REVIEW_REQUIRED'),
  );
  changed.feeds[0].reviewedChange = {
    status: 'APPROVED',
    previousSourceSha256: shaA,
    reviewedAt: now.toISOString(),
    reviewedBy: 'reviewer',
    reason: 'Published timetable refresh reviewed against source metadata.',
  };
  assert.equal(
    evaluateSourceChanges(registry, changed, baseline, policy, now).status,
    'PASS',
  );
});

test('station-count, parse-coverage, and parser-structure changes fail', () => {
  const changed = clone(current);
  changed.feeds[0].stationCount = 80;
  changed.feeds[0].parseCoverage = 0.9;
  changed.feeds[0].parserStructureVersion = 'adapter/2';
  const codes = evaluateSourceChanges(
    registry,
    changed,
    baseline,
    policy,
    now,
  ).failures.map((item) => item.code);
  assert.ok(codes.includes('STATION_COUNT_ANOMALY'));
  assert.ok(codes.includes('PARSE_COVERAGE_INVALID'));
  assert.ok(codes.includes('PARSER_STRUCTURE_CHANGED'));
});

test('unresolved source contracts remain blocked even with fabricated data', () => {
  const blockedRegistry = clone(registry);
  blockedRegistry.feeds[0].sourceType = 'unresolved';
  blockedRegistry.feeds[0].adapterVersion = null;
  blockedRegistry.feeds[0].currentSourceStatus = 'BLOCKED_SOURCE';
  assert.ok(
    evaluateSourceChanges(
      blockedRegistry,
      current,
      baseline,
      policy,
      now,
    ).failures.some((item) => item.code === 'SOURCE_CONTRACT_UNRESOLVED'),
  );
});

test('missing current feed is a top-level failure', () => {
  const result = evaluateSourceChanges(
    registry,
    { feeds: [] },
    baseline,
    policy,
    now,
  );
  assert.equal(result.status, 'FAIL');
  assert.ok(
    result.failures.some((item) => item.code === 'SOURCE_SNAPSHOT_MISSING'),
  );
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
