import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundaryMetrics,
  classifyRootCause,
  parseCsv,
  parseWarningDescription,
  summarizeDistances,
} from '../diagnose.mjs';

const feeds = ['jp-tokyo-jr-east', 'jp-tokyo-toei-rail', 'jp-tokyo-toei-bus'];

test('parses multi-stop pruned island warnings without changing event scope', () => {
  const parsed = parseWarningDescription(
    'PRUNED_STOP_ISLAND',
    'Unlinked stops from pruned walk subgraph osm:node:1 of 9 street vertices and 2 stops jp-tokyo-toei-bus:100-01,jp-tokyo-toei-bus:100-02. Edge changes: 2 to nothru, 4 to no walking, 6 erased',
    feeds,
  );
  assert.deepEqual(parsed.scopedIds, [
    { feedId: 'jp-tokyo-toei-bus', stopId: '100-01' },
    { feedId: 'jp-tokyo-toei-bus', stopId: '100-02' },
  ]);
  assert.deepEqual(parsed.pruned, {
    subgraph: 'osm:node:1',
    streetVertices: 9,
    changedToNoThru: 2,
    changedToNoWalking: 4,
    erasedEdges: 6,
  });
});

test('distinguishes outside coverage from an interior point', () => {
  const bounds = { left: 139.6, right: 139.9, bottom: 35.5, top: 35.8 };
  assert.equal(
    boundaryMetrics({ lat: 35.7, lon: 139.3 }, bounds).boundaryClass,
    'OUTSIDE_OSM_COVERAGE',
  );
  assert.equal(
    boundaryMetrics({ lat: 35.7, lon: 139.75 }, bounds).boundaryClass,
    'OSM_COVERAGE_INTERIOR',
  );
});

test('boundary cuts take precedence over linking-distance guesses', () => {
  assert.equal(
    classifyRootCause({
      warningTypes: ['ISOLATED_STOP'],
      warnings: [],
      modeCategory: 'bus',
      graphBoundary: { insideExtract: false, signedDistanceMeters: -100 },
      nearestOsmWalkableEdge: null,
      nearestOsmPlatform: null,
      nearestOsmStopPosition: null,
      nearestMappedStationObject: null,
    }),
    'GRAPH_BOUNDARY_CUT',
  );
});

test('treats unlinked siblings in one GTFS parent station as informational', () => {
  assert.equal(
    classifyRootCause({
      feedId: 'jp-tokyo-toei-bus',
      parentStation: '0442',
      warningTypes: ['UNLINKED_TRANSFER'],
      warnings: [],
      modeCategory: 'bus',
      graphBoundary: { insideExtract: true, signedDistanceMeters: 5000 },
      nearestTransitPeer: {
        feedId: 'jp-tokyo-toei-bus',
        parentStation: '0442',
        distanceMeters: 20,
        sameNormalizedName: true,
      },
      nearestOsmWalkableEdge: { distanceMeters: 2 },
      nearestOsmPlatform: null,
      nearestOsmStopPosition: null,
      nearestMappedStationObject: null,
    }),
    'EXPECTED_WITHIN_PARENT_STATION',
  );
});

test('requires a nearby pedestrian restriction before assigning access cause', () => {
  const base = {
    feedId: 'jp-tokyo-toei-bus',
    parentStation: '100',
    warningTypes: ['PRUNED_STOP_ISLAND'],
    warnings: [],
    modeCategory: 'bus',
    graphBoundary: { insideExtract: true, signedDistanceMeters: 5000 },
    nearestOsmWalkableEdge: { distanceMeters: 5 },
    nearestOsmPlatform: null,
    nearestOsmStopPosition: null,
    nearestMappedStationObject: null,
  };
  assert.equal(
    classifyRootCause({
      ...base,
      nearestRestrictedPedestrianEdge: {
        distanceMeters: 10,
        tags: { highway: 'service', access: 'private' },
      },
    }),
    'PRIVATE_OR_RESTRICTED_ACCESS',
  );
  assert.equal(
    classifyRootCause({
      ...base,
      nearestRestrictedPedestrianEdge: {
        distanceMeters: 10,
        tags: { highway: 'primary', foot: 'no' },
      },
    }),
    'ISLAND_ROAD',
  );
});

test('parses quoted GTFS CSV fields', () => {
  assert.deepEqual(parseCsv('id,name\n1,"A, B"\n'), [
    { id: '1', name: 'A, B' },
  ]);
});

test('uses nearest-rank percentiles and preserves missing snap measurements', () => {
  assert.deepEqual(summarizeDistances([1, 2, 3, 4, undefined]), {
    population: 5,
    measuredCount: 4,
    missingCount: 1,
    p50: 2,
    p95: 4,
    max: 4,
  });
});
