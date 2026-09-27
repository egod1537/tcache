import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateTransferResponse } from '../run-transfer-regression.mjs';
import { evaluateWalkResponse } from '../validate-complex-walks.mjs';

const complexMap = {
  complexes: [
    {
      stationComplexId: 'tokyo:test',
      members: [
        { scopedStopId: 'feed-a:stop-a' },
        { scopedStopId: 'feed-b:stop-b' },
      ],
    },
  ],
};

test('transfer regression requires a real walk between reviewed members', () => {
  const response = responseWithWalk(120);
  const result = evaluateTransferResponse(
    {
      id: 'case',
      category: 'TEST',
      expectedComplexId: 'tokyo:test',
      requiredFeeds: ['feed-a', 'feed-b'],
      feedOrder: ['feed-a', 'feed-b'],
    },
    response,
    complexMap,
  );
  assert.equal(result.status, 'PASS');
  assert.equal(result.expectedTransition.walkDurationSeconds, 120);
});

test('transfer regression rejects zero-second movement between different stops', () => {
  const response = responseWithWalk(0, false);
  const result = evaluateTransferResponse(
    {
      id: 'case',
      category: 'TEST',
      expectedComplexId: 'tokyo:test',
      requiredFeeds: ['feed-a', 'feed-b'],
    },
    response,
    complexMap,
  );
  assert.equal(result.status, 'FAIL');
});

test('direct complex walk rejects paths over 15 minutes', () => {
  assert.equal(evaluateWalkResponse(walkResponse(300)).status, 'PASS');
  assert.equal(evaluateWalkResponse(walkResponse(901)).status, 'FAIL');
});

function responseWithWalk(duration, includeWalk = true) {
  const walk = includeWalk
    ? [
        {
          mode: 'WALK',
          duration,
          distance: duration,
          start: { scheduledTime: '2026-09-29T10:05:00+09:00' },
          end: { scheduledTime: '2026-09-29T10:07:00+09:00' },
          from: {},
          to: {},
        },
      ]
    : [];
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              duration: 900,
              numberOfTransfers: 1,
              legs: [
                transitLeg('feed-a', 'stop-origin', 'stop-a', '10:00', '10:05'),
                ...walk,
                transitLeg(
                  'feed-b',
                  'stop-b',
                  'stop-destination',
                  '10:07',
                  '10:15',
                ),
              ],
            },
          },
        ],
      },
    },
  };
}

function transitLeg(feed, from, to, start, end) {
  return {
    mode: 'RAIL',
    transitLeg: true,
    duration: 300,
    start: { scheduledTime: `2026-09-29T${start}:00+09:00` },
    end: { scheduledTime: `2026-09-29T${end}:00+09:00` },
    from: { name: from, stop: { gtfsId: `${feed}:${from}` } },
    to: { name: to, stop: { gtfsId: `${feed}:${to}` } },
    agency: { gtfsId: `${feed}:agency` },
    route: { gtfsId: `${feed}:route` },
  };
}

function walkResponse(duration) {
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              duration,
              walkDistance: 100,
              legs: [{ mode: 'WALK' }],
            },
          },
        ],
      },
    },
  };
}
