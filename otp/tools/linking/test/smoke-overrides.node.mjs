import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateStopResponse } from '../smoke-overrides.mjs';

test('requires boarding at the exact overridden stop', () => {
  const response = {
    data: {
      planConnection: {
        routingErrors: [],
        edges: [
          {
            node: {
              duration: 600,
              legs: [
                {
                  transitLeg: true,
                  from: { stop: { gtfsId: 'feed:stop' } },
                  start: { scheduledTime: '2026-09-29T10:00:00+09:00' },
                  end: { scheduledTime: '2026-09-29T10:10:00+09:00' },
                },
              ],
            },
          },
        ],
      },
    },
  };
  assert.equal(evaluateStopResponse(response, 'feed:stop').status, 'PASS');
  assert.equal(evaluateStopResponse(response, 'feed:other').status, 'FAIL');
});
