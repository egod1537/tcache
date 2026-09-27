import assert from 'node:assert/strict';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { inspectTokyoMetroArchive } from '../inspect-tokyo-metro.mjs';

test('accepts all nine Tokyo Metro routes and preserves hierarchy metadata', () => {
  const routes = ['G', 'M', 'H', 'T', 'C', 'Y', 'Z', 'N', 'F'];
  const archive = zipSync({
    'agency.txt': csv(['agency_id,agency_name', 'metro,東京メトロ']),
    'feed_info.txt': csv([
      'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version',
      '東京メトロ,https://www.tokyometro.jp/,ja,20260919,20270312,20260921',
    ]),
    'routes.txt': csv([
      'route_id,agency_id,route_short_name,route_type',
      ...routes.map((route) => `${route},metro,${route},1`),
    ]),
    'stops.txt': csv([
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
      'station,Station,35.0,139.0,1,',
      'platform,Platform,35.0,139.0,0,station',
    ]),
    'trips.txt': csv([
      'route_id,service_id,trip_id,block_id',
      'G,weekday,g-trip,shared',
      'M,weekday,m-trip,shared',
    ]),
    'stop_times.txt': csv([
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'g-trip,10:00:00,10:00:00,platform,1',
      'm-trip,10:10:00,10:10:00,platform,1',
    ]),
    'calendar.txt': csv([
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
      'weekday,1,1,1,1,1,0,0,20260919,20270312',
    ]),
  });

  const result = inspectTokyoMetroArchive(archive);
  assert.equal(result.counts.routes, 9);
  assert.equal(result.counts.stopsWithParentStation, 1);
  assert.equal(result.counts.multiRouteBlocks, 1);
  assert.equal(result.hierarchyPolicy.sourceArchiveModified, false);
  assert.equal(result.throughServicePolicy.syntheticTripMergeAllowed, false);
});

test('rejects a feed when one Tokyo Metro route disappears', () => {
  const archive = zipSync({
    'agency.txt': csv(['agency_id,agency_name', 'metro,東京メトロ']),
    'feed_info.txt': csv([
      'feed_publisher_name,feed_publisher_url,feed_lang,feed_version',
      '東京メトロ,https://www.tokyometro.jp/,ja,test',
    ]),
    'routes.txt': csv([
      'route_id,agency_id,route_short_name,route_type',
      'G,metro,G,1',
    ]),
    'stops.txt': csv([
      'stop_id,stop_name,stop_lat,stop_lon',
      'G01,Shibuya,35.0,139.0',
    ]),
    'trips.txt': csv(['route_id,service_id,trip_id', 'G,weekday,g-trip']),
    'stop_times.txt': csv([
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'g-trip,10:00:00,10:00:00,G01,1',
    ]),
  });

  assert.throws(
    () => inspectTokyoMetroArchive(archive),
    /route contract changed/u,
  );
});

function csv(lines) {
  return strToU8(`${lines.join('\n')}\n`);
}
