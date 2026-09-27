import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { buildProductionCollectorConfig } from '../build-production-collector-config.mjs';

const repositoryRoot = new URL('../../../..', import.meta.url);

test('all 16 production critical stations have reviewed canonical complexes', async () => {
  const [registry, stationReview] = await Promise.all([
    readJson(
      new URL('otp/config/tokyo-rail-production-registry.json', repositoryRoot),
    ),
    readJson(new URL('otp/config/station-complex-review.json', repositoryRoot)),
  ]);
  const config = buildProductionCollectorConfig(registry, stationReview);
  assert.equal(config.criticalStations.length, 16);
  assert.equal(
    new Set(config.criticalStations.map((item) => item.id)).size,
    16,
  );
  assert.ok(
    config.criticalStations.every((station) => station.members.length > 0),
  );
});

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
