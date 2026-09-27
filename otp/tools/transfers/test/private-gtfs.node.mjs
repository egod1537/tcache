import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { strToU8, zipSync } from 'fflate';

import { inspectOfficialPrivateGtfs } from '../inspect-private-gtfs.mjs';

function fixture(routeNames) {
  const routes = routeNames
    .map((name, index) => `${index},K${index},${name},2`)
    .join('\n');
  return zipSync({
    'agency.txt': strToU8(
      'agency_id,agency_name,agency_url,agency_timezone\nkeio,京王電鉄,https://www.keio.co.jp/,Asia/Tokyo\n',
    ),
    'routes.txt': strToU8(
      `route_id,route_short_name,route_long_name,route_type\n${routes}\n`,
    ),
    'stops.txt': strToU8(
      'stop_id,stop_name,stop_lat,stop_lon\na,A,35.0,139.0\nb,B,35.1,139.1\n',
    ),
    'trips.txt': strToU8('route_id,service_id,trip_id\n0,w,t\n'),
    'stop_times.txt': strToU8(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,10:00:00,10:00:00,a,1\nt,10:10:00,10:10:00,b,2\n',
    ),
  });
}

test('Keio pass-through adapter requires all four target line contracts', () => {
  const result = inspectOfficialPrivateGtfs(
    fixture(['京王線', '井の頭線', '高尾線', '相模原線']),
    'keio',
  );
  assert.deepEqual(result.targetLines, [
    'keio',
    'inokashira',
    'takao',
    'sagamihara',
  ]);
  assert.equal(result.hierarchyPolicy.sourceArchiveModified, false);
});

test('Keio pass-through adapter fails when a priority line disappears', () => {
  assert.throws(
    () =>
      inspectOfficialPrivateGtfs(
        fixture(['京王線', '井の頭線', '高尾線']),
        'keio',
      ),
    /sagamihara/,
  );
});

test('Tobu and Sotetsu pass-through profiles enforce their core lines', () => {
  assert.deepEqual(
    inspectOfficialPrivateGtfs(
      fixture(['東上線', '東武スカイツリーライン']),
      'tobu',
    ).targetLines,
    ['tojo', 'skytree'],
  );
  assert.deepEqual(
    inspectOfficialPrivateGtfs(
      fixture(['相鉄本線', '相鉄いずみ野線']),
      'sotetsu',
    ).targetLines,
    ['main', 'izumino'],
  );
});

test('source registry classifies Tokyu, Keio, and Odakyu without fallback sources', async () => {
  const registry = JSON.parse(
    await readFile(
      new URL(
        '../../../config/private-core-source-registry.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      registry.operators.map((operator) => [
        operator.operatorId,
        operator.classification,
      ]),
    ),
    { tokyu: 'TYPE_B', keio: 'TYPE_A', odakyu: 'TYPE_B' },
  );
  assert.equal(registry.authentication.credentialStored, false);
  assert.equal(registry.scope.externalDistribution, false);
});

test('outer registry keeps unsupported Keisei fail-closed', async () => {
  const registry = JSON.parse(
    await readFile(
      new URL(
        '../../../config/private-outer-source-registry.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      registry.operators.map((operator) => [
        operator.operatorId,
        operator.classification,
      ]),
    ),
    {
      keikyu: 'TYPE_B',
      keisei: 'TYPE_D',
      seibu: 'TYPE_B',
      tobu: 'TYPE_A',
      sotetsu: 'TYPE_A',
    },
  );
  const keisei = registry.operators.find(
    (operator) => operator.operatorId === 'keisei',
  );
  assert.equal(keisei.status, 'BLOCKED_NO_TRAIN_LEVEL_MACHINE_SOURCE');
  assert.equal(
    keisei.paidLimitedExpressPolicy,
    'EXCLUDED_UNTIL_EXPLICITLY_MODELLED',
  );
});
