import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCoverageReport,
  renderCoverageMarkdown,
} from '../generate-coverage-report.mjs';

test('coverage report distinguishes verified, partial, and blocked lines', () => {
  const report = buildCoverageReport({
    registry: {
      registryVersion: 'registry',
      requiredFeedCount: 3,
      feeds: [
        {
          feedId: 'verified',
          operator: 'Verified',
          sourceType: 'official-gtfs',
          currentSourceStatus: 'BLOCKED_AUTH',
          lines: [{ id: 'line', name: 'Line', routeCode: 'V', required: true }],
        },
        {
          feedId: 'partial',
          operator: 'Partial',
          sourceType: 'official-gtfs',
          currentSourceStatus: 'READY',
          lines: [{ id: 'line', name: 'Line', routeCode: 'P', required: true }],
        },
        {
          feedId: 'blocked',
          operator: 'Blocked',
          sourceType: 'unresolved',
          currentSourceStatus: 'BLOCKED_SOURCE',
          lines: [{ id: 'line', name: 'Line', routeCode: 'B', required: true }],
        },
      ],
    },
    manifest: {
      buildId: 'build',
      inputs: [{ feedId: 'verified' }, { feedId: 'partial' }],
      preflight: {
        feeds: [
          { feedId: 'verified', errorCount: 0, warningCount: 0 },
          { feedId: 'partial', errorCount: 0, warningCount: 0 },
        ],
      },
    },
    smoke: {
      passed: 1,
      failed: 0,
      results: [
        {
          status: 'PASS',
          feeds: ['verified'],
          routes: ['V'],
        },
      ],
    },
    sourceChange: {
      feeds: [
        { feedId: 'verified', status: 'PASS', datasetVersion: '1' },
        { feedId: 'partial', status: 'PASS', datasetVersion: '1' },
      ],
    },
    linking: {
      perFeed: {
        verified: {
          totalStops: 10,
          linkedStops: 10,
          unlinkedTransferStops: 1,
        },
      },
    },
  });
  assert.deepEqual(
    report.rows.map((row) => row.status),
    ['VERIFIED', 'PARTIAL', 'BLOCKED'],
  );
  assert.equal(report.feedStatuses[0].linkedRatio, 1);
  assert.match(renderCoverageMarkdown(report), /\| Verified \| Line \|/);
});
