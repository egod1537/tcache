#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createOSMStream } from 'osm-pbf-parser-node';

const WARNING_FILES = {
  ISOLATED_STOP: 'IsolatedStop.geojson',
  UNLINKED_TRANSFER: 'StopNotLinkedForTransfers.geojson',
  PRUNED_STOP_ISLAND: 'PrunedStopIsland.geojson',
};

const ROOT_CAUSES = [
  'STOP_TOO_FAR_FROM_STREET',
  'STOP_TOO_FAR_FROM_PLATFORM',
  'MISSING_OSM_PLATFORM',
  'MISSING_OSM_STOP_POSITION',
  'WRONG_GTFS_COORDINATE',
  'STATION_COMPLEX_FRAGMENTED',
  'OSM_ACCESS_PATH_MISSING',
  'GRAPH_BOUNDARY_CUT',
  'ISLAND_ROAD',
  'PRIVATE_OR_RESTRICTED_ACCESS',
  'EXPECTED_WITHIN_PARENT_STATION',
  'NO_NEARBY_TRANSFER_PEER',
  'UNKNOWN',
];

const GRID_DEGREES = 0.01;
const MAX_OSM_SEARCH_METERS = 2_000;
const NODE_RETENTION_PADDING_CELLS = 3;
const EARTH_RADIUS_METERS = 6_371_008.8;
const OSM_MEASUREMENT_FIELDS = [
  'nearestOsmWalkableEdge',
  'nearestRestrictedPedestrianEdge',
  'nearestRailwayOrPlatformObject',
  'nearestOsmPlatform',
  'nearestOsmStopPosition',
  'nearestMappedStationObject',
  'nearestOsmEntrance',
];

export function parseWarningDescription(type, description, feedIds) {
  let scopedIds = [];
  let pruned = null;
  if (type === 'ISOLATED_STOP') {
    const match = description.match(/^Stop (.+?) is isolated,/);
    if (match) scopedIds = [match[1]];
  } else if (type === 'UNLINKED_TRANSFER') {
    const match = description.match(/^Stop \{(.+?) lat,lng=/);
    if (match) scopedIds = [match[1]];
  } else if (type === 'PRUNED_STOP_ISLAND') {
    const match = description.match(
      /subgraph (.+?) of (\d+) street vertices and \d+ stops? (.+?)\. Edge changes: (\d+) to nothru, (\d+) to no walking, (\d+) erased$/,
    );
    if (match) {
      scopedIds = match[3].split(',');
      pruned = {
        subgraph: match[1],
        streetVertices: Number(match[2]),
        changedToNoThru: Number(match[4]),
        changedToNoWalking: Number(match[5]),
        erasedEdges: Number(match[6]),
      };
    }
  }
  return {
    scopedIds: scopedIds.map((scopedId) => splitScopedId(scopedId, feedIds)),
    pruned,
  };
}

export function boundaryMetrics(point, bounds) {
  const inside =
    point.lon >= bounds.left &&
    point.lon <= bounds.right &&
    point.lat >= bounds.bottom &&
    point.lat <= bounds.top;
  const clamped = {
    lat: Math.max(bounds.bottom, Math.min(bounds.top, point.lat)),
    lon: Math.max(bounds.left, Math.min(bounds.right, point.lon)),
  };
  if (!inside) {
    return {
      insideExtract: false,
      signedDistanceMeters: -round(haversineMeters(point, clamped)),
      nearestSide: outsideSide(point, bounds),
      boundaryClass: 'OUTSIDE_OSM_COVERAGE',
    };
  }
  const sides = [
    ['west', haversineMeters(point, { ...point, lon: bounds.left })],
    ['east', haversineMeters(point, { ...point, lon: bounds.right })],
    ['south', haversineMeters(point, { ...point, lat: bounds.bottom })],
    ['north', haversineMeters(point, { ...point, lat: bounds.top })],
  ].sort((left, right) => left[1] - right[1]);
  const distance = sides[0][1];
  return {
    insideExtract: true,
    signedDistanceMeters: round(distance),
    nearestSide: sides[0][0],
    boundaryClass:
      distance <= 1_000 ? 'GRAPH_BOUNDARY_ADJACENT' : 'OSM_COVERAGE_INTERIOR',
  };
}

export function classifyRootCause(issue) {
  const warningTypes = new Set(issue.warningTypes);
  const walkDistance = issue.nearestOsmWalkableEdge?.distanceMeters ?? Infinity;
  const platformDistance = issue.nearestOsmPlatform?.distanceMeters ?? Infinity;
  const stopPositionDistance =
    issue.nearestOsmStopPosition?.distanceMeters ?? Infinity;
  const stationDistance =
    issue.nearestMappedStationObject?.distanceMeters ?? Infinity;
  const restrictedDistance =
    issue.nearestRestrictedPedestrianEdge?.distanceMeters ?? Infinity;
  const restrictedTags = issue.nearestRestrictedPedestrianEdge?.tags ?? {};
  const restrictionLooksCausal =
    restrictedDistance <= 25 &&
    restrictedDistance <= walkDistance + 15 &&
    ['footway', 'path', 'pedestrian', 'steps', 'service'].includes(
      restrictedTags.highway,
    ) &&
    (['no', 'private'].includes(restrictedTags.access) ||
      ['no', 'private'].includes(restrictedTags.foot));
  const hasPruned = warningTypes.has('PRUNED_STOP_ISLAND');
  const hasIsolated = warningTypes.has('ISOLATED_STOP');
  const hasOnlyUnlinked =
    warningTypes.size === 1 && warningTypes.has('UNLINKED_TRANSFER');

  if (!issue.graphBoundary.insideExtract) return 'GRAPH_BOUNDARY_CUT';
  if (hasPruned && restrictionLooksCausal) {
    return 'PRIVATE_OR_RESTRICTED_ACCESS';
  }
  if (hasOnlyUnlinked) {
    if (
      issue.parentStation &&
      issue.nearestTransitPeer?.feedId === issue.feedId &&
      issue.nearestTransitPeer.parentStation === issue.parentStation
    ) {
      return 'EXPECTED_WITHIN_PARENT_STATION';
    }
    if (
      issue.nearestTransitPeer &&
      issue.nearestTransitPeer.distanceMeters <= 500 &&
      ((issue.nearestTransitPeer.feedId !== issue.feedId &&
        issue.nearestTransitPeer.distanceMeters <= 150) ||
        (issue.nearestTransitPeer.sameNormalizedName &&
          (!issue.parentStation ||
            issue.nearestTransitPeer.parentStation !== issue.parentStation)))
    ) {
      return 'STATION_COMPLEX_FRAGMENTED';
    }
    return 'NO_NEARBY_TRANSFER_PEER';
  }
  if (walkDistance > 500 && issue.graphBoundary.signedDistanceMeters > 1_000) {
    return 'WRONG_GTFS_COORDINATE';
  }
  if (walkDistance > 100) return 'STOP_TOO_FAR_FROM_STREET';
  if (hasPruned) {
    if (issue.modeCategory !== 'bus' && stationDistance <= 300) {
      return 'STATION_COMPLEX_FRAGMENTED';
    }
    return 'ISLAND_ROAD';
  }
  if (
    hasIsolated &&
    issue.modeCategory === 'bus' &&
    stopPositionDistance > 100
  ) {
    return 'MISSING_OSM_STOP_POSITION';
  }
  if (hasIsolated && issue.modeCategory !== 'bus' && platformDistance > 150) {
    return 'MISSING_OSM_PLATFORM';
  }
  if (hasIsolated && issue.modeCategory !== 'bus' && platformDistance > 50) {
    return 'STOP_TOO_FAR_FROM_PLATFORM';
  }
  if (hasIsolated && walkDistance <= 100) return 'OSM_ACCESS_PATH_MISSING';
  return 'UNKNOWN';
}

function classifyPriority(issue) {
  const cause = issue.suspectedRootCause;
  if (
    cause === 'GRAPH_BOUNDARY_CUT' ||
    cause === 'WRONG_GTFS_COORDINATE' ||
    (issue.modeCategory !== 'bus' &&
      ['STATION_COMPLEX_FRAGMENTED', 'PRIVATE_OR_RESTRICTED_ACCESS'].includes(
        cause,
      ))
  ) {
    return { priority: 'P0', severity: 'critical' };
  }
  if (
    [
      'STOP_TOO_FAR_FROM_STREET',
      'STATION_COMPLEX_FRAGMENTED',
      'OSM_ACCESS_PATH_MISSING',
      'PRIVATE_OR_RESTRICTED_ACCESS',
    ].includes(cause) ||
    (issue.modeCategory !== 'bus' &&
      issue.warningTypes.includes('ISOLATED_STOP'))
  ) {
    return { priority: 'P1', severity: 'high' };
  }
  if (
    [
      'MISSING_OSM_PLATFORM',
      'MISSING_OSM_STOP_POSITION',
      'STOP_TOO_FAR_FROM_PLATFORM',
      'ISLAND_ROAD',
      'UNKNOWN',
    ].includes(cause)
  ) {
    return { priority: 'P2', severity: 'medium' };
  }
  return { priority: 'P3', severity: 'informational' };
}

function recommendedAction(issue) {
  const actions = {
    GRAPH_BOUNDARY_CUT:
      'Use a wider Tokyo/Kanto OSM extract, rebuild, and compare this stop before changing linking thresholds.',
    WRONG_GTFS_COORDINATE:
      'Verify the GTFS coordinate against the operator source and reviewed station mapping.',
    STOP_TOO_FAR_FROM_STREET:
      'Inspect the GTFS point and nearest pedestrian way; correct source coordinates or add the missing OSM access path.',
    STOP_TOO_FAR_FROM_PLATFORM:
      'Review platform geometry and station entrances; do not increase the global threshold until the local mapping is verified.',
    MISSING_OSM_PLATFORM:
      'Map or verify the OSM public_transport platform and its pedestrian connection.',
    MISSING_OSM_STOP_POSITION:
      'Map or verify the OSM bus stop/stop_position and connect it to the pedestrian network.',
    STATION_COMPLEX_FRAGMENTED:
      'Review station entrances, platform paths, parent_station grouping, and cross-feed stop placement as one complex.',
    OSM_ACCESS_PATH_MISSING:
      'Add or repair the local pedestrian access path between the stop/platform and the connected street graph.',
    ISLAND_ROAD:
      'Inspect the small pedestrian component and connect valid paths to the main walk graph.',
    PRIVATE_OR_RESTRICTED_ACCESS:
      'Verify access/foot tags and station passage permissions; change OSM only when ground truth supports it.',
    NO_NEARBY_TRANSFER_PEER:
      'No action unless this stop should be an interchange; this warning is informational for a true singleton stop.',
    EXPECTED_WITHIN_PARENT_STATION:
      'No OSM action: sibling platforms are already grouped by GTFS parent_station; review only if cross-feed transfer is expected.',
    UNKNOWN:
      'Review this stop manually using the GeoJSON evidence and OTP import report.',
  };
  return actions[issue.suspectedRootCause];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolve(options.buildRoot);
  const outputDir = resolve(
    options.outputDir ?? `${buildRoot}/diagnostics/linking`,
  );
  const reportDir = `${buildRoot}/graph/build-report`;
  const buildConfig = JSON.parse(
    await readFile(`${buildRoot}/build-config.json`, 'utf8'),
  );
  const buildManifest = JSON.parse(
    await readFile(`${buildRoot}/manifests/build-manifest.json`, 'utf8'),
  );
  const feedConfigs = buildConfig.transitFeeds.map((feed) => ({
    feedId: feed.feedId,
    zipPath: `${buildRoot}/${feed.source}`,
  }));
  const feedIds = feedConfigs.map((feed) => feed.feedId);

  const feeds = feedConfigs.map(loadGtfsFeed);
  const stops = new Map();
  for (const feed of feeds) {
    for (const stop of feed.stops.values()) {
      stops.set(scopedKey(feed.feedId, stop.stopId), stop);
    }
  }
  addNearestTransitPeers(stops);

  const { events, issues } = await loadWarnings(reportDir, feedIds, stops);
  const operationalStops = [...stops.values()].filter(
    (stop) => stop.locationType === 0 && stop.routes.length > 0,
  );
  const osmTargets = new Map(
    operationalStops.map((stop) => [stop.scopedStopId, stop]),
  );
  for (const issue of issues.values()) {
    if (!osmTargets.has(issue.scopedStopId)) {
      osmTargets.set(issue.scopedStopId, issue);
    }
  }
  const osmPath = `${buildRoot}/${buildConfig.osm[0].source}`;
  const osmResult = await analyzeOsm(osmPath, osmTargets);

  for (const issue of issues.values()) {
    const measured = osmTargets.get(issue.scopedStopId);
    copyOsmMeasurements(measured, issue);
    issue.graphBoundary = boundaryMetrics(issue, osmResult.bounds);
    issue.geography = classifyGeography(issue, issue.graphBoundary);
    issue.suspectedRootCause = classifyRootCause(issue);
    Object.assign(issue, classifyPriority(issue));
    issue.recommendedAction = recommendedAction(issue);
    issue.causeEvidence = buildCauseEvidence(issue);
    cleanIssue(issue);
  }

  const issueList = [...issues.values()].sort(compareIssues);
  const summary = buildSummary(events, issueList);
  const linkingFailureStopIds = new Set(
    issueList
      .filter((issue) =>
        issue.warningTypes.some((type) =>
          ['ISOLATED_STOP', 'PRUNED_STOP_ISLAND'].includes(type),
        ),
      )
      .map((issue) => issue.scopedStopId),
  );
  summary.stopInventory = buildStopInventory(
    operationalStops,
    linkingFailureStopIds,
  );
  summary.osmSnappingDistanceMeters = buildSnappingMetrics(operationalStops);
  const generatedAt = new Date().toISOString();
  const inputFingerprint = await sha256Files([
    `${buildRoot}/build-config.json`,
    osmPath,
    ...feedConfigs.map((feed) => feed.zipPath),
    ...Object.values(WARNING_FILES).map((file) => `${reportDir}/${file}`),
  ]);
  const result = {
    schemaVersion: '1.0',
    generatedAt,
    buildId: buildManifest.buildId,
    inputFingerprint,
    sourceArtifacts: {
      buildManifest: 'manifests/build-manifest.json',
      buildConfig: 'build-config.json',
      osm: buildConfig.osm[0].source,
      otpReportDirectory: 'graph/build-report',
      transitFeeds: buildConfig.transitFeeds,
    },
    osm: {
      bounds: osmResult.bounds,
      parsedNodes: osmResult.parsedNodes,
      retainedNodes: osmResult.retainedNodes,
      parsedWays: osmResult.parsedWays,
    },
    methodology: {
      eventVsStop:
        'OTP GeoJSON features are warning events. Multi-stop pruned-island events are expanded to stop-level issue references without changing the original event count.',
      distanceModel:
        'Distances are local equirectangular point-to-OSM-segment distances over the exact build PBF; boundary distances use haversine distance.',
      stopCohort:
        'Quality totals and OSM snapping percentiles include location_type=0 stops referenced by at least one stop_times route. Parent stations and unused stop rows are excluded.',
      osmSearchRadiusMeters: MAX_OSM_SEARCH_METERS,
      thresholdPolicy:
        'Thresholds are diagnostic heuristics only and do not modify OTP linking or island-pruning settings.',
      geography:
        'Coverage classes use the PBF header bounds. TOKYO_23_WARDS_APPROX is an explicit coarse envelope, not an administrative polygon.',
      rootCauseVocabulary: ROOT_CAUSES,
    },
    summary,
    issues: issueList,
  };

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(`${outputDir}/otp-linking-issues.json`, result),
    writeJson(
      `${outputDir}/otp-linking-issues.geojson`,
      buildGeoJson(issueList),
    ),
    writeFile(
      `${outputDir}/otp-linking-diagnosis.md`,
      buildDiagnosisMarkdown(result, buildConfig),
      'utf8',
    ),
    writeFile(
      `${outputDir}/otp-linking-top-offenders.md`,
      buildTopOffendersMarkdown(result),
      'utf8',
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ outputDir, eventCounts: summary.warningEvents, uniqueAffectedStops: summary.uniqueAffectedStops, rootCauses: summary.byRootCause }, null, 2)}\n`,
  );
}

function loadGtfsFeed({ feedId, zipPath }) {
  const stopRows = parseCsv(readZipEntry(zipPath, 'stops.txt'));
  const routeRows = parseCsv(readZipEntry(zipPath, 'routes.txt'));
  const tripRows = parseCsv(readZipEntry(zipPath, 'trips.txt'));
  const stopTimeRows = parseCsv(readZipEntry(zipPath, 'stop_times.txt'));
  const routes = new Map(
    routeRows.map((route) => [
      route.route_id,
      {
        routeId: route.route_id,
        routeType: Number(route.route_type),
        mode: gtfsMode(Number(route.route_type)),
        name: route.route_short_name || route.route_long_name || route.route_id,
      },
    ]),
  );
  const tripRoute = new Map(
    tripRows.map((trip) => [trip.trip_id, trip.route_id]),
  );
  const routesByStop = new Map();
  for (const stopTime of stopTimeRows) {
    const route = routes.get(tripRoute.get(stopTime.trip_id));
    if (!route) continue;
    const values = routesByStop.get(stopTime.stop_id) ?? new Map();
    values.set(route.routeId, route);
    routesByStop.set(stopTime.stop_id, values);
  }
  const stops = new Map();
  for (const row of stopRows) {
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const stopRoutes = [...(routesByStop.get(row.stop_id)?.values() ?? [])];
    const modes = [...new Set(stopRoutes.map((route) => route.mode))].sort();
    stops.set(row.stop_id, {
      feedId,
      stopId: row.stop_id,
      scopedStopId: scopedKey(feedId, row.stop_id),
      stopName: row.stop_name,
      lat,
      lon,
      parentStation: row.parent_station || null,
      locationType: Number(row.location_type || 0),
      routes: stopRoutes,
      modes,
      modeCategory: modeCategory(feedId, modes),
    });
  }
  return { feedId, stops };
}

async function loadWarnings(reportDir, feedIds, stops) {
  const events = [];
  const issues = new Map();
  for (const [type, filename] of Object.entries(WARNING_FILES)) {
    const collection = await readOptionalFeatureCollection(
      `${reportDir}/${filename}`,
    );
    for (const [index, feature] of collection.features.entries()) {
      const description = feature.properties?.description ?? '';
      const parsed = parseWarningDescription(type, description, feedIds);
      const event = {
        eventId: `${type}:${index + 1}`,
        type,
        description,
        featureId: feature.id ?? null,
        stopKeys: parsed.scopedIds.map(({ feedId, stopId }) =>
          scopedKey(feedId, stopId),
        ),
        pruned: parsed.pruned,
      };
      events.push(event);
      for (const { feedId, stopId } of parsed.scopedIds) {
        const key = scopedKey(feedId, stopId);
        const stop = stops.get(key);
        const fallback = featurePoint(feature);
        const issue = issues.get(key) ?? {
          feedId,
          stopId,
          scopedStopId: key,
          stopName: stop?.stopName ?? null,
          lat: stop?.lat ?? fallback.lat,
          lon: stop?.lon ?? fallback.lon,
          parentStation: stop?.parentStation ?? null,
          locationType: stop?.locationType ?? null,
          routes: stop?.routes ?? [],
          modes: stop?.modes ?? [],
          modeCategory: stop?.modeCategory ?? modeCategory(feedId, []),
          warningTypes: [],
          warnings: [],
          nearestTransitPeer: stop?.nearestTransitPeer ?? null,
          nearestOsmWalkableEdge: null,
          nearestRestrictedPedestrianEdge: null,
          nearestRailwayOrPlatformObject: null,
          nearestOsmPlatform: null,
          nearestOsmStopPosition: null,
          nearestMappedStationObject: null,
          nearestOsmEntrance: null,
        };
        issue.warningTypes.push(type);
        issue.warnings.push({
          eventId: event.eventId,
          type,
          description,
          pruned: parsed.pruned,
        });
        issues.set(key, issue);
      }
    }
  }
  for (const issue of issues.values()) {
    issue.warningTypes = [...new Set(issue.warningTypes)].sort();
  }
  return { events, issues };
}

export async function analyzeOsm(path, issues) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'tcache-osm-diagnosis-'),
  );
  const diagnosticPath = join(temporaryDirectory, 'linking-relevant.osm.pbf');
  try {
    execFileSync(
      'osmium',
      [
        'tags-filter',
        '--no-progress',
        '-o',
        diagnosticPath,
        path,
        'w/highway',
        'w/railway',
        'w/public_transport',
        'n/railway',
        'n/public_transport',
        'n/highway=bus_stop',
      ],
      { stdio: 'ignore' },
    );
    return await analyzeFilteredOsm(diagnosticPath, issues);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function analyzeFilteredOsm(path, issues) {
  const issueList = [...issues.values()];
  const issueGrid = makePointGrid(issueList);
  const retainedCellKeys = new Set();
  for (const issue of issueList) {
    const { x, y } = gridPosition(issue);
    for (
      let dx = -NODE_RETENTION_PADDING_CELLS;
      dx <= NODE_RETENTION_PADDING_CELLS;
      dx += 1
    ) {
      for (
        let dy = -NODE_RETENTION_PADDING_CELLS;
        dy <= NODE_RETENTION_PADDING_CELLS;
        dy += 1
      ) {
        retainedCellKeys.add(gridKey(x + dx, y + dy));
      }
    }
  }
  const nodes = new Map();
  let bounds = null;
  let parsedNodes = 0;
  let parsedWays = 0;
  for await (const object of createOSMStream(path, {
    withTags: true,
    withInfo: false,
  })) {
    if (object.bbox) {
      bounds = {
        left: object.bbox.left / 1e9,
        right: object.bbox.right / 1e9,
        top: object.bbox.top / 1e9,
        bottom: object.bbox.bottom / 1e9,
      };
      continue;
    }
    if (object.type === 'node') {
      parsedNodes += 1;
      if (retainedCellKeys.has(gridKeyForPoint(object))) {
        nodes.set(object.id, {
          lat: object.lat,
          lon: object.lon,
          tags: object.tags ?? null,
        });
      }
      if (object.tags) {
        updatePointObject(issueGrid, object, object.tags, 'node');
      }
      continue;
    }
    if (object.type !== 'way') continue;
    parsedWays += 1;
    const tags = object.tags ?? {};
    if (!isRelevantWay(tags)) continue;
    for (let index = 1; index < object.refs.length; index += 1) {
      const start = nodes.get(object.refs[index - 1]);
      const end = nodes.get(object.refs[index]);
      if (!start || !end) continue;
      updateSegmentObject(issueGrid, start, end, object.id, tags);
    }
  }
  if (!bounds) throw new Error(`OSM PBF has no header bounds: ${path}`);
  return {
    bounds,
    parsedNodes,
    retainedNodes: nodes.size,
    parsedWays,
  };
}

function updatePointObject(issueGrid, object, tags, objectType) {
  const categories = osmCategories(tags);
  if (categories.length === 0) return;
  for (const issue of nearbyIssues(issueGrid, object, object)) {
    const distance = haversineMeters(issue, object);
    if (distance > MAX_OSM_SEARCH_METERS) continue;
    for (const category of categories) {
      updateNearest(issue, category, distance, {
        elementType: objectType,
        elementId: object.id,
        lat: object.lat,
        lon: object.lon,
        name: osmName(tags),
        tags: selectedTags(tags),
      });
    }
  }
}

function updateSegmentObject(issueGrid, start, end, wayId, tags) {
  const categories = osmCategories(tags);
  const pedestrian = pedestrianAccess(tags);
  if (pedestrian === 'allowed') categories.push('nearestOsmWalkableEdge');
  if (pedestrian === 'restricted') {
    categories.push('nearestRestrictedPedestrianEdge');
  }
  if (categories.length === 0) return;
  for (const issue of nearbyIssues(issueGrid, start, end)) {
    const distance = pointToSegmentMeters(issue, start, end);
    if (distance > MAX_OSM_SEARCH_METERS) continue;
    for (const category of categories) {
      updateNearest(issue, category, distance, {
        elementType: 'way',
        elementId: wayId,
        name: osmName(tags),
        tags: selectedTags(tags),
      });
    }
  }
}

function osmCategories(tags) {
  const categories = [];
  const isPlatform =
    tags.public_transport === 'platform' || tags.railway === 'platform';
  const isStopPosition =
    tags.public_transport === 'stop_position' || tags.highway === 'bus_stop';
  const isStation =
    tags.public_transport === 'station' ||
    ['station', 'halt', 'tram_stop'].includes(tags.railway);
  const isEntrance =
    ['subway_entrance', 'train_station_entrance'].includes(tags.railway) ||
    (tags.entrance && tags.entrance !== 'no' && tags.public_transport);
  if (isPlatform) categories.push('nearestOsmPlatform');
  if (isStopPosition) categories.push('nearestOsmStopPosition');
  if (isStation) categories.push('nearestMappedStationObject');
  if (isEntrance) categories.push('nearestOsmEntrance');
  if (isPlatform || isStopPosition || isStation || isEntrance) {
    categories.push('nearestRailwayOrPlatformObject');
  }
  return categories;
}

function pedestrianAccess(tags) {
  if (!tags.highway && tags.public_transport !== 'platform') return 'none';
  if (
    [
      'motorway',
      'motorway_link',
      'construction',
      'proposed',
      'raceway',
    ].includes(tags.highway)
  ) {
    return 'none';
  }
  if (['yes', 'designated', 'permissive'].includes(tags.foot)) return 'allowed';
  if (
    ['no', 'private', 'use_sidepath'].includes(tags.foot) ||
    ['no', 'private'].includes(tags.access)
  ) {
    return 'restricted';
  }
  return 'allowed';
}

function isRelevantWay(tags) {
  return (
    pedestrianAccess(tags) !== 'none' ||
    osmCategories(tags).length > 0 ||
    Boolean(tags.railway)
  );
}

function updateNearest(issue, field, distance, object) {
  const current = issue[field];
  if (current && current.distanceMeters <= distance) return;
  issue[field] = { distanceMeters: round(distance), ...object };
}

function addNearestTransitPeers(stops) {
  const stopList = [...stops.values()].filter(
    (stop) => stop.locationType === 0,
  );
  const grid = makePointGrid(stopList);
  for (const stop of stopList) {
    let nearest = null;
    for (const candidate of nearbyIssues(grid, stop, stop, 2)) {
      if (candidate.scopedStopId === stop.scopedStopId) continue;
      const distance = haversineMeters(stop, candidate);
      if (!nearest || distance < nearest.distanceMeters) {
        nearest = {
          scopedStopId: candidate.scopedStopId,
          feedId: candidate.feedId,
          stopId: candidate.stopId,
          stopName: candidate.stopName,
          parentStation: candidate.parentStation,
          distanceMeters: round(distance),
          sameNormalizedName:
            normalizeName(candidate.stopName) === normalizeName(stop.stopName),
        };
      }
    }
    stop.nearestTransitPeer = nearest;
  }
}

function classifyGeography(point, boundary) {
  let areaCategory;
  if (point.lon < 139.56) areaCategory = 'WESTERN_SUBURB';
  else if (point.lon <= 139.93 && point.lat >= 35.52 && point.lat <= 35.82) {
    areaCategory = 'TOKYO_23_WARDS_APPROX';
  } else areaCategory = 'OTHER_OUTER_AREA';
  return {
    areaCategory,
    coverageClass: boundary.boundaryClass,
  };
}

function buildCauseEvidence(issue) {
  return {
    warningTypes: issue.warningTypes,
    insideOsmExtract: issue.graphBoundary.insideExtract,
    boundaryDistanceMeters: issue.graphBoundary.signedDistanceMeters,
    nearestWalkableEdgeMeters:
      issue.nearestOsmWalkableEdge?.distanceMeters ?? null,
    nearestPlatformMeters: issue.nearestOsmPlatform?.distanceMeters ?? null,
    nearestStopPositionMeters:
      issue.nearestOsmStopPosition?.distanceMeters ?? null,
    nearestStationObjectMeters:
      issue.nearestMappedStationObject?.distanceMeters ?? null,
    nearestTransitPeerMeters: issue.nearestTransitPeer?.distanceMeters ?? null,
    nearestTransitPeerSameName:
      issue.nearestTransitPeer?.sameNormalizedName ?? false,
  };
}

function copyOsmMeasurements(source, destination) {
  if (!source) return;
  for (const field of OSM_MEASUREMENT_FIELDS) {
    destination[field] = source[field] ?? null;
  }
}

function cleanIssue(issue) {
  for (const field of OSM_MEASUREMENT_FIELDS) {
    if (!issue[field]) issue[field] = null;
  }
}

export function summarizeDistances(values) {
  const measured = values
    .filter(Number.isFinite)
    .map(Number)
    .sort((left, right) => left - right);
  const percentile = (fraction) => {
    if (measured.length === 0) return null;
    const index = Math.max(0, Math.ceil(measured.length * fraction) - 1);
    return round(measured[index]);
  };
  return {
    population: values.length,
    measuredCount: measured.length,
    missingCount: values.length - measured.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: measured.length ? round(measured.at(-1)) : null,
  };
}

function buildSnappingMetrics(stops) {
  const metrics = {
    all: summarizeDistances(
      stops.map((stop) => stop.nearestOsmWalkableEdge?.distanceMeters),
    ),
    byFeed: {},
  };
  for (const feedId of [...new Set(stops.map((stop) => stop.feedId))].sort()) {
    const feedStops = stops.filter((stop) => stop.feedId === feedId);
    metrics.byFeed[feedId] = summarizeDistances(
      feedStops.map((stop) => stop.nearestOsmWalkableEdge?.distanceMeters),
    );
  }
  return metrics;
}

function buildStopInventory(stops, linkingFailureStopIds) {
  const byFeed = {};
  for (const feedId of [...new Set(stops.map((stop) => stop.feedId))].sort()) {
    const feedStops = stops.filter((stop) => stop.feedId === feedId);
    const linkedStops = feedStops.filter(
      (stop) => !linkingFailureStopIds.has(stop.scopedStopId),
    ).length;
    byFeed[feedId] = {
      totalStops: feedStops.length,
      linkedStops,
      linkingFailureStops: feedStops.length - linkedStops,
    };
  }
  const totalStops = stops.length;
  const linkedStops = stops.filter(
    (stop) => !linkingFailureStopIds.has(stop.scopedStopId),
  ).length;
  return {
    cohort: 'stop_times-referenced-location-type-0',
    totalStops,
    linkedStops,
    linkingFailureStops: totalStops - linkedStops,
    stopKeys: stops.map((stop) => stop.scopedStopId).sort(),
    byFeed,
  };
}

function buildSummary(events, issues) {
  const warningEvents = countBy(events, (event) => event.type);
  const warningEventsByFeed = {};
  for (const event of events) {
    const feeds = [
      ...new Set(event.stopKeys.map((key) => key.split('::', 1)[0])),
    ];
    for (const feed of feeds) {
      warningEventsByFeed[event.type] ??= {};
      warningEventsByFeed[event.type][feed] =
        (warningEventsByFeed[event.type][feed] ?? 0) + 1;
    }
  }
  const stopWarningReferences = {};
  const warningReferencesByMode = {};
  const warningReferencesByArea = {};
  const warningReferencesByCoverage = {};
  const warningReferencesByRootCause = {};
  for (const issue of issues) {
    for (const warning of issue.warnings) {
      stopWarningReferences[warning.type] ??= {};
      stopWarningReferences[warning.type][issue.feedId] =
        (stopWarningReferences[warning.type][issue.feedId] ?? 0) + 1;
      incrementNested(
        warningReferencesByMode,
        warning.type,
        issue.modeCategory,
      );
      incrementNested(
        warningReferencesByArea,
        warning.type,
        issue.geography.areaCategory,
      );
      incrementNested(
        warningReferencesByCoverage,
        warning.type,
        issue.geography.coverageClass,
      );
      incrementNested(
        warningReferencesByRootCause,
        warning.type,
        issue.suspectedRootCause,
      );
    }
  }
  const topOffenders = buildTopOffenders(issues);
  return {
    warningEvents,
    warningEventsByFeed,
    stopWarningReferences,
    warningReferencesByMode,
    warningReferencesByArea,
    warningReferencesByCoverage,
    warningReferencesByRootCause,
    uniqueAffectedStops: issues.length,
    byFeed: countBy(issues, (issue) => issue.feedId),
    byMode: countBy(issues, (issue) => issue.modeCategory),
    byArea: countBy(issues, (issue) => issue.geography.areaCategory),
    byCoverage: countBy(issues, (issue) => issue.geography.coverageClass),
    byRootCause: countBy(issues, (issue) => issue.suspectedRootCause),
    byPriority: countBy(issues, (issue) => issue.priority),
    topOffenders,
  };
}

function buildTopOffenders(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const stationKey = issue.parentStation
      ? `${issue.feedId}:${issue.parentStation}`
      : `${issue.feedId}:name:${normalizeName(issue.stopName)}`;
    const group = groups.get(stationKey) ?? {
      stationKey,
      feedId: issue.feedId,
      stationName: issue.stopName,
      affectedStops: new Set(),
      warningReferences: 0,
      warningTypes: new Set(),
      rootCauses: new Map(),
      priorities: new Map(),
      areaCategories: new Set(),
    };
    group.affectedStops.add(issue.stopId);
    group.warningReferences += issue.warnings.length;
    issue.warningTypes.forEach((type) => group.warningTypes.add(type));
    group.rootCauses.set(
      issue.suspectedRootCause,
      (group.rootCauses.get(issue.suspectedRootCause) ?? 0) + 1,
    );
    group.priorities.set(
      issue.priority,
      (group.priorities.get(issue.priority) ?? 0) + 1,
    );
    group.areaCategories.add(issue.geography.areaCategory);
    groups.set(stationKey, group);
  }
  return [...groups.values()]
    .map((group) => ({
      stationKey: group.stationKey,
      feedId: group.feedId,
      stationName: group.stationName,
      affectedStopCount: group.affectedStops.size,
      warningReferences: group.warningReferences,
      warningTypes: [...group.warningTypes].sort(),
      rootCauses: Object.fromEntries(
        [...group.rootCauses.entries()].sort(
          (left, right) => right[1] - left[1],
        ),
      ),
      priorities: Object.fromEntries(group.priorities),
      areaCategories: [...group.areaCategories].sort(),
    }))
    .sort(
      (left, right) =>
        right.warningReferences - left.warningReferences ||
        right.affectedStopCount - left.affectedStopCount ||
        left.stationKey.localeCompare(right.stationKey),
    )
    .slice(0, 20);
}

function buildGeoJson(issues) {
  const features = [];
  for (const issue of issues) {
    for (const warningType of issue.warningTypes) {
      features.push({
        type: 'Feature',
        id: `${warningType}:${issue.scopedStopId}`,
        geometry: {
          type: 'Point',
          coordinates: [issue.lon, issue.lat],
        },
        properties: {
          layer: warningType,
          feedId: issue.feedId,
          stopId: issue.stopId,
          stopName: issue.stopName,
          parentStation: issue.parentStation,
          mode: issue.modeCategory,
          rootCause: issue.suspectedRootCause,
          priority: issue.priority,
          severity: issue.severity,
          area: issue.geography.areaCategory,
          coverage: issue.geography.coverageClass,
          insideOsmExtract: issue.graphBoundary.insideExtract,
          boundaryDistanceMeters: issue.graphBoundary.signedDistanceMeters,
          nearestWalkableEdgeMeters:
            issue.nearestOsmWalkableEdge?.distanceMeters ?? null,
          nearestRailwayOrPlatformMeters:
            issue.nearestRailwayOrPlatformObject?.distanceMeters ?? null,
          recommendedAction: issue.recommendedAction,
        },
      });
    }
  }
  return {
    type: 'FeatureCollection',
    name: 'Tokyo OTP linking issues',
    features,
  };
}

function buildDiagnosisMarkdown(result, buildConfig) {
  const summary = result.summary;
  const eventRows = Object.keys(WARNING_FILES).map((type) => [
    type,
    summary.warningEvents[type] ?? 0,
    ...buildConfig.transitFeeds.map(
      (feed) => summary.warningEventsByFeed[type]?.[feed.feedId] ?? 0,
    ),
  ]);
  const causeRows = Object.entries(summary.byRootCause).sort(
    (left, right) => right[1] - left[1],
  );
  const coverageRows = Object.entries(summary.byCoverage).sort(
    (left, right) => right[1] - left[1],
  );
  const dimensionRows = Object.keys(WARNING_FILES).map((type) => [
    type,
    compactCounts(summary.stopWarningReferences[type]),
    compactCounts(summary.warningReferencesByMode[type]),
    compactCounts(summary.warningReferencesByArea[type]),
    compactCounts(summary.warningReferencesByCoverage[type]),
    compactCounts(summary.warningReferencesByRootCause[type]),
  ]);
  const p0 = result.issues.filter((issue) => issue.priority === 'P0');
  const p1 = result.issues.filter((issue) => issue.priority === 'P1');
  return `# Tokyo OTP OSM linking diagnosis

Generated: ${result.generatedAt}  
Build: \`${result.buildId}\`

## Executive finding

The three OTP warning classes are not equivalent. \`IsolatedStop\` and \`PrunedStopIsland\` indicate street-graph access risk. \`StopNotLinkedForTransfers\` often means only that OTP found no nearby transit peer for an automatic transfer; sibling platforms already grouped by one GTFS \`parent_station\` and true singleton stops are retained as informational unless spatial evidence shows a fragmented station complex.

The exact PBF header bounds are ${formatBounds(result.osm.bounds)}. Stops outside this rectangle are classified as \`GRAPH_BOUNDARY_CUT\`; widening a linking threshold cannot repair missing OSM coverage.

## Original warning events

${markdownTable(
  ['Warning', 'Total', ...buildConfig.transitFeeds.map((feed) => feed.feedId)],
  eventRows,
)}

OTP reported exactly ${sum(Object.values(summary.warningEvents))} events: ${Object.entries(
    summary.warningEvents,
  )
    .map(([type, count]) => `${type} ${count}`)
    .join(
      ', ',
    )}. Multi-stop pruned-island events were expanded for stop-level remediation, producing ${result.issues.length} unique affected stops.

## Stop-reference dimensions

${markdownTable(
  ['Warning', 'Feed', 'Mode', 'Area', 'Coverage', 'Suspected cause'],
  dimensionRows,
)}

These are stop-warning references, so \`PRUNED_STOP_ISLAND\` totals 68 references from 60 events because eight additional stops share multi-stop islands.

## Root-cause classification

${markdownTable(['Suspected root cause', 'Unique stops'], causeRows)}

## OSM coverage and geography

${markdownTable(['Coverage class', 'Unique stops'], coverageRows)}

${markdownTable(
  ['Area class', 'Unique stops'],
  Object.entries(summary.byArea).sort((left, right) => right[1] - left[1]),
)}

\`TOKYO_23_WARDS_APPROX\` is a coarse diagnostic envelope and is not presented as an administrative boundary. Coverage classification is exact relative to the build PBF bounds.

## Build-parameter assessment

- \`platformEntriesLinking\`: ${String(buildConfig.platformEntriesLinking)}
- \`includeOsmStationEntrances\`: ${String(buildConfig.osm[0].includeOsmStationEntrances)}
- Custom \`islandPruning\`: ${buildConfig.islandPruning ? 'present' : 'absent; OTP 2.10 defaults apply'}
- Observed OTP defaults in build log: islands with stops 2, without stops 10, adaptive factor 50.0, distance 250 m.
- No stop-linking or island-pruning threshold was changed by this diagnosis.

Increasing a global threshold would hide boundary omissions and can connect stops across barriers. Fix P0/P1 coordinates, coverage, access paths, and station-complex topology first. Parameter experiments should be isolated A/B rebuilds only after those corrections.

## Boundary assessment

- Outside the current PBF: ${summary.byCoverage.OUTSIDE_OSM_COVERAGE ?? 0} unique affected stops.
- Inside but within 1 km of an extract edge: ${summary.byCoverage.GRAPH_BOUNDARY_ADJACENT ?? 0}.
- Interior: ${summary.byCoverage.OSM_COVERAGE_INTERIOR ?? 0}.

A Kanto-wide PBF is expected to remove the *coverage* condition for outside-west/east stops, but this has not been claimed as an empirical warning-count comparison because no Kanto graph was built in this task. It will not automatically repair station footpaths, private-access tags, or small interior street islands.

## Remediation queue

- P0: ${p0.length} stops. Actual coverage/coordinate or core rail-station access failures; verify first.
- P1: ${p1.length} stops. High routing-quality risk; fix local OSM/GTFS topology next.
- P2: ${summary.byPriority.P2 ?? 0} stops. Local/outer-area or mapping completeness work.
- P3: ${summary.byPriority.P3 ?? 0} stops. Primarily informational singleton-transfer warnings.

See \`otp-linking-issues.json\` for every distance and source warning, \`otp-linking-issues.geojson\` for map review, and \`otp-linking-top-offenders.md\` for the first remediation batch.

## References

- OTP 2.10 build configuration: https://docs.opentripplanner.org/en/v2.10.0/BuildConfiguration/
- OpenStreetMap PBF input used by this graph: \`${buildConfig.osm[0].source}\`
- Every result is derived from the versioned local build inputs and OTP report; no live Overpass result is mixed into the diagnosis.
`;
}

function buildTopOffendersMarkdown(result) {
  const rows = result.summary.topOffenders.map((offender, index) => [
    index + 1,
    offender.feedId,
    offender.stationName ?? offender.stationKey,
    offender.affectedStopCount,
    offender.warningReferences,
    offender.warningTypes.join(', '),
    Object.entries(offender.rootCauses)
      .map(([cause, count]) => `${cause} (${count})`)
      .join(', '),
  ]);
  const priorityRows = samplePriorityActions(result.issues).map((issue) => [
    issue.priority,
    issue.feedId,
    issue.stopId,
    issue.stopName ?? '',
    issue.modeCategory,
    issue.suspectedRootCause,
    issue.graphBoundary.signedDistanceMeters,
    issue.nearestOsmWalkableEdge?.distanceMeters ?? 'n/a',
    issue.recommendedAction,
  ]);
  return `# Tokyo OTP linking top offenders

Build: \`${result.buildId}\`  
Ranking uses warning references first, then affected stop count. Parent stations are used when GTFS supplies them; otherwise normalized stop names form the station/area group.

## Top 20 station/area groups

${markdownTable(
  [
    '#',
    'Feed',
    'Station/area',
    'Stops',
    'Warnings',
    'Warning types',
    'Root causes',
  ],
  rows,
)}

## P0/P1 action list

This table includes at most 20 representative stops per root-cause group. The JSON artifact contains the complete queue.

${markdownTable(
  [
    'Priority',
    'Feed',
    'Stop ID',
    'Name',
    'Mode',
    'Cause',
    'Boundary m',
    'Walk edge m',
    'Recommended action',
  ],
  priorityRows,
)}
`;
}

function compareIssues(left, right) {
  const priority = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (
    priority[left.priority] - priority[right.priority] ||
    left.feedId.localeCompare(right.feedId) ||
    String(left.stopName).localeCompare(String(right.stopName)) ||
    left.stopId.localeCompare(right.stopId)
  );
}

function parseArgs(args) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const options = {
    buildRoot: resolve(scriptDir, '../../data/japan/tokyo/builds/latest'),
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--build-root') options.buildRoot = args[++index];
    else if (args[index] === '--output-dir') options.outputDir = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

function splitScopedId(value, feedIds) {
  const feedId = [...feedIds]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => value.startsWith(`${candidate}:`));
  if (!feedId) throw new Error(`Unknown feed-scoped stop ID: ${value}`);
  return { feedId, stopId: value.slice(feedId.length + 1) };
}

function scopedKey(feedId, stopId) {
  return `${feedId}::${stopId}`;
}

function readZipEntry(path, entry) {
  return execFileSync('unzip', ['-p', path, entry], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, ''));
  if (!headers) return [];
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? '']),
      ),
    );
}

function featurePoint(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type === 'Point') {
    return { lon: coordinates[0], lat: coordinates[1] };
  }
  if (feature.geometry?.type === 'MultiPoint' && coordinates.length) {
    return { lon: coordinates[0][0], lat: coordinates[0][1] };
  }
  throw new Error(`Warning feature has no usable point: ${feature.id}`);
}

function gtfsMode(routeType) {
  if (routeType === 0) return 'tram';
  if (routeType === 1) return 'subway';
  if ([2, 100, 101, 102, 103, 104, 105, 106, 107].includes(routeType)) {
    return 'rail';
  }
  if ([3, 11, 700, 701, 702, 703, 704, 705, 706, 707].includes(routeType)) {
    return 'bus';
  }
  return `route_type_${routeType}`;
}

function modeCategory(feedId, modes) {
  if (modes.includes('bus') || feedId.includes('bus')) return 'bus';
  if (feedId === 'jp-tokyo-jr-east') return 'rail';
  return 'subway/tram';
}

function makePointGrid(points) {
  const grid = new Map();
  for (const point of points) {
    const key = gridKeyForPoint(point);
    const values = grid.get(key) ?? [];
    values.push(point);
    grid.set(key, values);
  }
  return grid;
}

function nearbyIssues(grid, start, end, padding = 1) {
  const min = gridPosition({
    lat: Math.min(start.lat, end.lat),
    lon: Math.min(start.lon, end.lon),
  });
  const max = gridPosition({
    lat: Math.max(start.lat, end.lat),
    lon: Math.max(start.lon, end.lon),
  });
  const result = new Set();
  for (let x = min.x - padding; x <= max.x + padding; x += 1) {
    for (let y = min.y - padding; y <= max.y + padding; y += 1) {
      for (const issue of grid.get(gridKey(x, y)) ?? []) result.add(issue);
    }
  }
  return result;
}

function gridPosition(point) {
  return {
    x: Math.floor(point.lon / GRID_DEGREES),
    y: Math.floor(point.lat / GRID_DEGREES),
  };
}

function gridKeyForPoint(point) {
  const position = gridPosition(point);
  return gridKey(position.x, position.y);
}

function gridKey(x, y) {
  return `${x}:${y}`;
}

function pointToSegmentMeters(point, start, end) {
  const lat0 = toRadians(point.lat);
  const scaleX = EARTH_RADIUS_METERS * Math.cos(lat0);
  const scaleY = EARTH_RADIUS_METERS;
  const ax = toRadians(start.lon - point.lon) * scaleX;
  const ay = toRadians(start.lat - point.lat) * scaleY;
  const bx = toRadians(end.lon - point.lon) * scaleX;
  const by = toRadians(end.lat - point.lat) * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t =
    denominator === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function haversineMeters(left, right) {
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(right.lon - left.lon);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function outsideSide(point, bounds) {
  const sides = [];
  if (point.lon < bounds.left) sides.push('west');
  if (point.lon > bounds.right) sides.push('east');
  if (point.lat < bounds.bottom) sides.push('south');
  if (point.lat > bounds.top) sides.push('north');
  return sides.join('+');
}

function selectedTags(tags) {
  return Object.fromEntries(
    [
      'highway',
      'railway',
      'public_transport',
      'access',
      'foot',
      'service',
      'entrance',
      'name',
      'name:ja',
      'ref',
    ]
      .filter((key) => tags[key] !== undefined)
      .map((key) => [key, tags[key]]),
  );
}

function osmName(tags) {
  return tags['name:ja'] || tags.name || null;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s駅・ヶケが]/g, '');
}

function countBy(values, key) {
  const result = {};
  for (const value of values) {
    const name = key(value);
    result[name] = (result[name] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

function incrementNested(target, outer, inner) {
  target[outer] ??= {};
  target[outer][inner] = (target[outer][inner] ?? 0) + 1;
}

function compactCounts(value = {}) {
  return Object.entries(value)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
}

function samplePriorityActions(issues) {
  const byPriorityAndCause = new Map();
  for (const issue of issues.filter((value) =>
    ['P0', 'P1'].includes(value.priority),
  )) {
    const key = `${issue.priority}:${issue.suspectedRootCause}`;
    const values = byPriorityAndCause.get(key) ?? [];
    if (values.length < 20) values.push(issue);
    byPriorityAndCause.set(key, values);
  }
  return [...byPriorityAndCause.values()].flat().sort(compareIssues);
}

function markdownTable(headers, rows) {
  const escape = (value) =>
    String(value ?? '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

function formatBounds(bounds) {
  return `west ${bounds.left}, east ${bounds.right}, south ${bounds.bottom}, north ${bounds.top}`;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function sha256Files(paths) {
  const hash = createHash('sha256');
  for (const path of paths) {
    try {
      const info = await stat(path);
      hash.update(`${basename(path)}:${info.size}:`);
      hash.update(await readFile(path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      hash.update(`${basename(path)}:missing:`);
    }
  }
  return hash.digest('hex');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readOptionalFeatureCollection(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { type: 'FeatureCollection', features: [] };
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
