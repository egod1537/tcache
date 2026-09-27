import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

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

test('requires the configured JR route instead of accepting feed identity alone', () => {
  const response = {
    data: {
      planConnection: {
        routingErrors: [],
        edges: [
          {
            node: {
              start: '2026-09-29T10:00:00+09:00',
              end: '2026-09-29T10:10:00+09:00',
              duration: 600,
              numberOfTransfers: 0,
              legs: [leg('jp-tokyo-jr-east:jr-east', 'JY', '10:00', '10:10')],
            },
          },
        ],
      },
    },
  };

  const result = evaluateSmokeResponse(
    {
      id: 'route-specific-fixture',
      category: 'JR_ONLY',
      requiredFeeds: ['jp-tokyo-jr-east'],
      requiredRoutes: ['JC'],
    },
    response,
  );
  assert.equal(result.status, 'FAIL');
});

test('requires a real transfer for any cross-feed transfer category', () => {
  const route = {
    id: 'jr-metro',
    category: 'JR_METRO_TRANSFER',
    requiredFeeds: ['jp-tokyo-jr-east', 'jp-tokyo-metro'],
  };
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
              numberOfTransfers: 0,
              legs: [
                leg('jp-tokyo-jr-east:jr-east', 'JC', '10:00', '10:10'),
                leg('jp-tokyo-metro:metro', 'M', '10:10', '10:20'),
              ],
            },
          },
        ],
      },
    },
  };

  assert.equal(evaluateSmokeResponse(route, response).status, 'FAIL');
});

test('rejects excessive walking and geometric detours in the final suite', () => {
  const transitLeg = leg('jp-tokyo-jr-east:jr-east', 'JC', '10:00', '10:30');
  transitLeg.distance = 100_000;
  const result = evaluateSmokeResponse(
    {
      id: 'detour-fixture',
      category: 'JR_ONLY',
      origin: { latitude: 35.68, longitude: 139.76 },
      destination: { latitude: 35.69, longitude: 139.77 },
      requiredFeeds: ['jp-tokyo-jr-east'],
      qualityConstraints: {
        maxTransfers: 2,
        maxWalkSeconds: 900,
        maxDurationSeconds: 3600,
        maxDistanceDetourFactor: 6,
      },
    },
    {
      data: {
        planConnection: {
          routingErrors: [],
          edges: [
            {
              node: {
                start: '2026-09-29T10:00:00+09:00',
                end: '2026-09-29T10:30:00+09:00',
                duration: 1800,
                walkTime: 1200,
                numberOfTransfers: 0,
                legs: [transitLeg],
              },
            },
          ],
        },
      },
    },
  );
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.candidates[0].qualityConstraintFailures, [
    'MAX_WALK_TIME_EXCEEDED',
    'MAX_DISTANCE_DETOUR_EXCEEDED',
  ]);
});

test('Metro regression contract covers 20 internal and 20 cross-feed ODs', async () => {
  const config = JSON.parse(
    await readFile(
      new URL('../config/tokyo-metro-smoke-tests.json', import.meta.url),
      'utf8',
    ),
  );
  const count = (category) =>
    config.routes.filter((route) => route.category === category).length;
  assert.equal(count('METRO_ONLY'), 20);
  assert.equal(count('JR_METRO_TRANSFER'), 10);
  assert.equal(count('TOEI_METRO_TRANSFER'), 10);
  assert.deepEqual(
    [
      ...new Set(
        config.routes
          .filter((route) => route.category === 'METRO_ONLY')
          .flatMap((route) => route.requiredRoutes),
      ),
    ].sort(),
    ['C', 'F', 'G', 'H', 'M', 'N', 'T', 'Y', 'Z'],
  );
});

test('private-core regression contract covers all three operators and 32 ODs', async () => {
  const config = JSON.parse(
    await readFile(
      new URL('../config/private-core-smoke-tests.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(config.routes.length, 32);
  assert.equal(
    config.routes.filter((route) => route.category === 'PRIVATE_ONLY').length,
    20,
  );
  assert.equal(
    config.routes.filter((route) => route.category === 'PRIVATE_JR_TRANSFER')
      .length,
    6,
  );
  assert.equal(
    config.routes.filter((route) => route.category === 'PRIVATE_METRO_TRANSFER')
      .length,
    6,
  );
  const coveredFeeds = new Set(
    config.routes.flatMap((route) => route.requiredFeeds),
  );
  for (const feed of ['jp-tokyo-tokyu', 'jp-tokyo-keio', 'jp-tokyo-odakyu']) {
    assert.equal(coveredFeeds.has(feed), true);
  }
});

test('private-core build and quality overlays require seven feeds and 83 ODs', async () => {
  const [build, gate] = await Promise.all([
    readFile(
      new URL(
        '../config/private-core-integrated-build-config.json',
        import.meta.url,
      ),
      'utf8',
    ).then(JSON.parse),
    readFile(
      new URL(
        '../config/private-core-quality-gate-overlay.json',
        import.meta.url,
      ),
      'utf8',
    ).then(JSON.parse),
  ]);
  assert.equal(build.transitFeeds.length, 7);
  assert.equal(new Set(build.transitFeeds.map((feed) => feed.feedId)).size, 7);
  assert.equal(gate.smokeRequiredCaseCount, 83);
  assert.equal(gate.activation, 'AFTER_FIRST_VALIDATED_PRIVATE_CORE_GRAPH');
});

test('private-outer regression contract covers airports and five stable feed IDs', async () => {
  const config = JSON.parse(
    await readFile(
      new URL('../config/airport-regression-cases.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(config.routes.length >= 30, true);
  assert.equal(
    config.routes.filter((route) => route.category === 'AIRPORT_ONLY').length >=
      8,
    true,
  );
  const coveredFeeds = new Set(
    config.routes.flatMap((route) => route.requiredFeeds),
  );
  for (const feed of [
    'jp-tokyo-keikyu',
    'jp-tokyo-keisei',
    'jp-tokyo-seibu',
    'jp-tokyo-tobu',
    'jp-tokyo-sotetsu',
  ]) {
    assert.equal(coveredFeeds.has(feed), true);
  }
  assert.equal(
    config.routes.some((route) => route.id === 'keikyu-shinagawa-haneda-t3'),
    true,
  );
  assert.equal(
    config.routes.some((route) => route.id === 'keisei-ueno-narita-airport'),
    true,
  );
});

test('private-outer candidate config keeps 12 feed IDs unique and gate inactive', async () => {
  const [build, gate] = await Promise.all([
    readFile(
      new URL(
        '../config/private-outer-integrated-build-config.json',
        import.meta.url,
      ),
      'utf8',
    ).then(JSON.parse),
    readFile(
      new URL(
        '../config/private-outer-quality-gate-overlay.json',
        import.meta.url,
      ),
      'utf8',
    ).then(JSON.parse),
  ]);
  assert.equal(build.transitFeeds.length, 12);
  assert.equal(new Set(build.transitFeeds.map((feed) => feed.feedId)).size, 12);
  assert.equal(build.status, 'PROSPECTIVE_BLOCKED_UNTIL_ALL_SOURCES_VALIDATE');
  assert.equal(gate.smokeRequiredCaseCount, 118);
  assert.equal(gate.activation, 'AFTER_ALL_FIVE_VALIDATED_PRIVATE_OUTER_FEEDS');
  assert.deepEqual(Object.keys(gate.perFeedBudgets).sort(), [
    'jp-tokyo-keikyu',
    'jp-tokyo-keisei',
    'jp-tokyo-seibu',
    'jp-tokyo-sotetsu',
    'jp-tokyo-tobu',
  ]);
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
