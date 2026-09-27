import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  expandReviewedComplex,
  scoreCandidate,
} from '../build-station-complexes.mjs';
import { normalizeStationName, parseCsv } from '../lib.mjs';

test('CSV parser preserves quoted commas', () => {
  assert.deepEqual(parseCsv('id,name\n1,"A, B"\n'), [
    { id: '1', name: 'A, B' },
  ]);
});

test('station names normalize Japanese station suffixes without merging arbitrary names', () => {
  assert.equal(normalizeStationName('日暮里駅前'), '日暮里');
  assert.equal(normalizeStationName('日暮里'), '日暮里');
  assert.notEqual(
    normalizeStationName('西日暮里'),
    normalizeStationName('日暮里'),
  );
});

test('candidate score exposes evidence but never decides auto merge', () => {
  const candidate = scoreCandidate(
    { stopName: '巣鴨', lat: 35.7333, lon: 139.7393, mode: 'RAIL' },
    { stopName: '巣鴨駅', lat: 35.7338, lon: 139.7382, mode: 'SUBWAY' },
  );
  assert.equal(candidate.evidence.exactNormalizedName, true);
  assert.ok(candidate.score > 0.5);
  assert.ok(candidate.distanceMeters > 0);
});

test('reviewed members may use an exact station code without guessing names', () => {
  const station = {
    stop_id: 'odpt.Station:TokyoMetro.Ginza.Shibuya',
    stop_code: 'G01',
    stop_name: '渋谷',
    stop_lat: '35.658',
    stop_lon: '139.701',
    location_type: '0',
    parent_station: '',
  };
  const feed = {
    feedId: 'jp-tokyo-metro',
    stops: [station],
    stopById: new Map([[station.stop_id, station]]),
    childrenByParent: new Map(),
    routeTypesByStop: new Map([[station.stop_id, new Set([1])]]),
  };
  const members = expandReviewedComplex(
    {
      id: 'tokyo:shibuya',
      confidence: 'HIGH',
      members: [{ feedId: feed.feedId, stationCode: 'G01' }],
    },
    new Map([[feed.feedId, feed]]),
  );

  assert.equal(members[0].stopId, station.stop_id);
  assert.equal(members[0].mode, 'SUBWAY');
});
