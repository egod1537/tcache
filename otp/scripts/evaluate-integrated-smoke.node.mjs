import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSmokeResponse } from './evaluate-integrated-smoke.mjs';

test('accepts a zero-wait boundary between ordered legs', () => {
  const response = {
    data: {
      planConnection: {
        routingErrors: [],
        edges: [
          {
            node: {
              start: '2026-09-29T10:00:00+09:00',
              end: '2026-09-29T10:20:00+09:00',
              duration: 1200,
              numberOfTransfers: 1,
              legs: [
                leg('jp-tokyo-jr-east:jr-east', 'RAIL', '10:00', '10:10'),
                leg(undefined, 'WALK', '10:10', '10:12', false),
                leg('jp-tokyo-toei-rail:toei', 'SUBWAY', '10:15', '10:20'),
              ],
            },
          },
        ],
      },
    },
  };
  const result = evaluateSmokeResponse(
    {
      id: 'transfer-fixture',
      category: 'JR_TOEI_TRANSFER',
      requiredFeeds: ['jp-tokyo-jr-east', 'jp-tokyo-toei-rail'],
    },
    response,
  );

  assert.equal(result.status, 'PASS');
  assert.equal(result.temporalOrderValid, true);
});

test('separates service-date and OSM-linking routing failures', () => {
  const route = { id: 'failure-fixture', category: 'TOEI_ONLY' };
  const noRoute = (code) => ({
    data: {
      planConnection: {
        edges: [],
        routingErrors: [{ code }],
      },
    },
  });

  assert.equal(
    evaluateSmokeResponse(route, noRoute('OUTSIDE_SERVICE_PERIOD'))
      .failureCategory,
    'SERVICE_DATE_ERROR',
  );
  assert.equal(
    evaluateSmokeResponse(route, noRoute('OUTSIDE_BOUNDS')).failureCategory,
    'OSM_LINKING_ERROR',
  );
});

function leg(feed, mode, start, end, transitLeg = true) {
  return {
    mode,
    transitLeg,
    start: { scheduledTime: `2026-09-29T${start}:00+09:00` },
    end: { scheduledTime: `2026-09-29T${end}:00+09:00` },
    from: { stop: transitLeg ? { gtfsId: `${feed}:from` } : null },
    to: { stop: transitLeg ? { gtfsId: `${feed}:to` } : null },
    agency: feed ? { gtfsId: feed, name: feed } : null,
    route: { shortName: mode },
  };
}
