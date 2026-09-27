import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { assembleRegressionSuite } from '../assemble-regression-suite.mjs';

const repositoryRoot = new URL('../../../..', import.meta.url);

test('assembles the deterministic 148-case final Tokyo rail suite', async () => {
  const config = await readJson(
    new URL('otp/config/tokyo-rail-regression-sources.json', repositoryRoot),
  );
  const sources = await Promise.all(
    config.sources.map((source) =>
      readJson(new URL(`otp/${source}`, repositoryRoot)),
    ),
  );
  const suite = assembleRegressionSuite(config, sources);
  assert.equal(suite.routes.length, 148);
  assert.equal(new Set(suite.routes.map((route) => route.id)).size, 148);
  assert.deepEqual(
    new Set(suite.routes.flatMap((route) => route.requiredFeeds)),
    new Set(config.requiredFeedIds),
  );
  assert.ok(
    Object.values(suite.contract.coverageGroups).every((count) => count > 0),
  );
  assert.ok(
    suite.routes.every(
      (route) =>
        route.qualityConstraints.maxTransfers === 5 &&
        route.qualityConstraints.maxDistanceDetourFactor === 6,
    ),
  );
});

test('rejects duplicate route IDs', () => {
  const config = {
    minimumRouteCount: 2,
    expectedRouteCount: 2,
    requiredFeedIds: ['feed'],
    sources: ['one', 'two'],
  };
  const route = {
    id: 'duplicate',
    category: 'JR_ONLY',
    requiredFeeds: ['feed'],
  };
  assert.throws(
    () =>
      assembleRegressionSuite(config, [
        { departureTime: 'time', itineraryCount: 1, routes: [route] },
        { departureTime: 'time', itineraryCount: 1, routes: [route] },
      ]),
    /Duplicate regression route IDs/,
  );
});

test('production registry and OTP build config use the exact same 12 feeds', async () => {
  const [registry, buildConfig] = await Promise.all([
    readJson(
      new URL('otp/config/tokyo-rail-production-registry.json', repositoryRoot),
    ),
    readJson(
      new URL('otp/config/tokyo-rail-final-build-config.json', repositoryRoot),
    ),
  ]);
  const registered = registry.feeds.map((feed) => feed.feedId);
  const configured = buildConfig.transitFeeds.map((feed) => feed.feedId);
  assert.equal(registered.length, 12);
  assert.equal(new Set(registered).size, 12);
  assert.deepEqual(new Set(configured), new Set(registered));
  assert.deepEqual(
    registry.feeds
      .find((feed) => feed.feedId === 'jp-tokyo-jr-east')
      .lines.map((line) => line.routeCode),
    ['JY', 'JC', 'JB', 'JK'],
  );
  assert.equal(
    registry.feeds.find((feed) => feed.feedId === 'jp-tokyo-metro').lines
      .length,
    9,
  );
});

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
