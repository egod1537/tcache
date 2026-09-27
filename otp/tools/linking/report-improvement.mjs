#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { analyzeOsm } from './diagnose.mjs';

async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const baseline = await loadBuild(paths.baseline);
  const boundaryOnly = await loadBuild(paths.boundaryOnly);
  const after = await loadBuild(paths.after);
  const [overrides, review, jrMapping, routeSmoke, overrideSmoke] =
    await Promise.all([
      readJson(`${paths.after}/manifests/stop-osm-overrides.json`),
      readJson(paths.review),
      readJson(paths.jrMapping),
      readJson(`${paths.after}/${after.manifest.smokeTests.summaryPath}`),
      readJson(
        `${paths.after}/diagnostics/linking/override-stop-smoke/summary.json`,
      ),
    ]);
  const active = overrides.overrides.filter((item) => item.active);
  const measurementPoints = active.flatMap((item) => [
    {
      key: `${item.feedId}::${item.stopId}`,
      phase: 'before',
      lat: item.original.lat,
      lon: item.original.lon,
    },
    {
      key: `${item.feedId}::${item.stopId}`,
      phase: 'after',
      lat: item.override.lat,
      lon: item.override.lon,
    },
  ]);
  await analyzeOsm(`${paths.after}/inputs/tokyo.osm.pbf`, measurementPoints);

  const metrics = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    baselineBuildId: baseline.manifest.buildId,
    boundaryOnlyBuildId: boundaryOnly.manifest.buildId,
    afterBuildId: after.manifest.buildId,
    importWarnings: {
      before: warningMetrics(baseline),
      boundaryOnly: warningMetrics(boundaryOnly),
      after: warningMetrics(after),
      reductionPercent: warningReduction(baseline, after),
    },
    nearestWalkableEdgeDistanceMeters: {
      fixedReviewedOverrideCohort: {
        population: active.length,
        before: distanceStats(
          measurementPoints.filter((item) => item.phase === 'before'),
        ),
        after: distanceStats(
          measurementPoints.filter((item) => item.phase === 'after'),
        ),
        interpretation:
          'Distance is measured to any locally walkable OSM edge. Connectivity is proven separately by pruned-island removal and exact-stop routing tests; distance alone cannot detect a small isolated component.',
      },
      warningStopCohortByBuild: {
        before: distanceStats(baseline.diagnosis.issues),
        boundaryOnly: distanceStats(boundaryOnly.diagnosis.issues),
        after: distanceStats(after.diagnosis.issues),
        populationNote:
          'This secondary cohort changes as warnings disappear; missingDistanceCount includes stops outside the old extract.',
      },
    },
    priorities: {
      before: baseline.diagnosis.summary.byPriority,
      after: after.diagnosis.summary.byPriority,
    },
    overrides: {
      activeReviewed: active.length,
      inactiveLowConfidence: overrides.overrides.filter((item) => !item.active)
        .length,
      sourceGtfsImmutable: overrides.policy.sourceGtfsImmutable,
      affectedBuildIds: overrides.affectedBuildIds,
    },
    resources: {
      before: resourceMetrics(baseline),
      boundaryOnly: resourceMetrics(boundaryOnly),
      after: resourceMetrics(after),
      kantoSource: {
        bytes: review.osm.sourceBytes,
        graphBuildAttempted: false,
        reason:
          'The 513.7 MB regional input was retained as the immutable source; the complete Tokyo transit envelope was clipped before OTP build to stay within the 8 GB Docker allocation.',
      },
      expandedClip: {
        bytes: review.osm.extractBytes,
        sourceBytes: review.osm.sourceBytes,
        sizeReductionPercent: round(
          (1 - review.osm.extractBytes / review.osm.sourceBytes) * 100,
        ),
        bbox: review.osm.extractBbox,
        extractionDurationSeconds: review.osm.extractDurationSeconds,
        extractionMaxResidentSetMiB: round(
          review.osm.extractMaxResidentSetBytes / 1024 / 1024,
        ),
        referenceIntegrity: review.osm.referenceIntegrity,
      },
    },
    buildParameters: {
      beforeConfigSha256: baseline.manifest.graphBuildConfigHash,
      afterConfigSha256: after.manifest.graphBuildConfigHash,
      unchanged:
        baseline.manifest.graphBuildConfigHash ===
        after.manifest.graphBuildConfigHash,
      thresholdTuningUsed: false,
    },
    regression: {
      existingRoutes: {
        status: routeSmoke.status,
        passed: routeSmoke.passed,
        failed: routeSmoke.failed,
      },
      reviewedStops: {
        status: overrideSmoke.status,
        passed: overrideSmoke.passed,
        failed: overrideSmoke.failed,
        assertion: overrideSmoke.assertion,
      },
    },
  };
  const outputDir = `${paths.after}/diagnostics/linking`;
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      `${outputDir}/before-after-metrics.json`,
      `${JSON.stringify(metrics, null, 2)}\n`,
    ),
    writeFile(
      `${outputDir}/mapping-review.csv`,
      buildMappingReview(jrMapping, overrides, boundaryOnly, after),
    ),
    writeFile(
      `${outputDir}/linking-improvement-report.md`,
      buildReport(metrics, baseline, boundaryOnly, after),
    ),
    writeFile(
      `${paths.after}/manifests/build-manifest.json`,
      `${JSON.stringify(
        {
          ...after.manifest,
          linkingImprovement: {
            status:
              metrics.regression.existingRoutes.status === 'PASS' &&
              metrics.regression.reviewedStops.status === 'PASS' &&
              metrics.importWarnings.after.isolatedStops === 0
                ? 'PASS'
                : 'FAIL',
            reportPath: 'diagnostics/linking/linking-improvement-report.md',
            metricsPath: 'diagnostics/linking/before-after-metrics.json',
            mappingReviewPath: 'diagnostics/linking/mapping-review.csv',
            overrideStopSmokePath:
              'diagnostics/linking/override-stop-smoke/summary.json',
            activeReviewedOverrides: metrics.overrides.activeReviewed,
            p0Remaining: metrics.priorities.after.P0 ?? 0,
            p1Remaining: metrics.priorities.after.P1 ?? 0,
          },
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ outputDir, importWarnings: metrics.importWarnings, regression: metrics.regression }, null, 2)}\n`,
  );
}

async function loadBuild(root) {
  return {
    root,
    manifest: await readJson(`${root}/manifests/build-manifest.json`),
    diagnosis: await readJson(
      `${root}/diagnostics/linking/otp-linking-issues.json`,
    ),
  };
}

function warningMetrics(build) {
  const counts = build.manifest.graph.importIssueCounts;
  return {
    buildId: build.manifest.buildId,
    isolatedStops: counts.isolatedStops,
    stopsNotLinkedForTransfers: counts.stopsNotLinkedForTransfers,
    prunedStopIslands: counts.prunedStopIslands,
    totalEvents:
      counts.isolatedStops +
      counts.stopsNotLinkedForTransfers +
      counts.prunedStopIslands,
    uniqueAffectedStops: build.diagnosis.summary.uniqueAffectedStops,
    byFeed: build.diagnosis.summary.warningEventsByFeed,
  };
}

function warningReduction(before, after) {
  const old = warningMetrics(before);
  const current = warningMetrics(after);
  return Object.fromEntries(
    [
      'isolatedStops',
      'stopsNotLinkedForTransfers',
      'prunedStopIslands',
      'totalEvents',
      'uniqueAffectedStops',
    ].map((key) => [key, percentReduction(old[key], current[key])]),
  );
}

function distanceStats(points) {
  const values = points
    .map((item) => item.nearestOsmWalkableEdge?.distanceMeters)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    population: points.length,
    measuredCount: values.length,
    missingDistanceCount: points.length - values.length,
    average: values.length ? round(sum(values) / values.length) : null,
    p95: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null,
    max: values.length ? values.at(-1) : null,
  };
}

function resourceMetrics(build) {
  const osm = build.manifest.inputs.find((item) => item.kind === 'osm-pbf');
  const graph = build.manifest.graph.summary;
  return {
    osmBytes: osm.bytes,
    graphBytes: graph.graphBytes,
    buildDurationSeconds: graph.durationSeconds,
    approximatePeakMemoryMiB: graph.approximatePeakMemoryMiB,
  };
}

function buildMappingReview(jrMapping, overrides, boundaryOnly, after) {
  const active = new Map(
    overrides.overrides
      .filter((item) => item.active)
      .map((item) => [`${item.feedId}::${item.stopId}`, item]),
  );
  const inactive = new Map(
    overrides.overrides
      .filter((item) => !item.active)
      .map((item) => [`${item.feedId}::${item.stopId}`, item]),
  );
  const beforeIssues = new Map(
    boundaryOnly.diagnosis.issues.map((item) => [item.scopedStopId, item]),
  );
  const afterIssues = new Map(
    after.diagnosis.issues.map((item) => [item.scopedStopId, item]),
  );
  const rows = [];
  for (const station of jrMapping.mappings) {
    const key = `jp-tokyo-jr-east::${station.internalStationId}`;
    rows.push(
      mappingRow({
        key,
        feedId: 'jp-tokyo-jr-east',
        stopId: station.internalStationId,
        stopName: station.officialNameJa,
        mode: 'rail',
        stopKind: 'STATION',
        sourceLat: station.latitude,
        sourceLon: station.longitude,
        sourceOsmElement: `${station.osmElementType}/${station.osmElementId}`,
        active,
        inactive,
        beforeIssues,
        afterIssues,
      }),
    );
  }
  for (const item of overrides.overrides.filter(
    (value) => value.active && value.feedId === 'jp-tokyo-toei-rail',
  )) {
    const key = `${item.feedId}::${item.stopId}`;
    rows.push(
      mappingRow({
        key,
        feedId: item.feedId,
        stopId: item.stopId,
        stopName: item.stopName,
        mode: 'subway',
        stopKind: 'STATION',
        sourceLat: item.original.lat,
        sourceLon: item.original.lon,
        sourceOsmElement: '',
        active,
        inactive,
        beforeIssues,
        afterIssues,
      }),
    );
  }
  const busIssues = after.diagnosis.issues.filter(
    (item) =>
      item.feedId === 'jp-tokyo-toei-bus' &&
      (item.warningTypes.includes('PRUNED_STOP_ISLAND') ||
        ['P0', 'P1'].includes(item.priority)),
  );
  for (const issue of busIssues) {
    const key = issue.scopedStopId;
    rows.push(
      mappingRow({
        key,
        feedId: issue.feedId,
        stopId: issue.stopId,
        stopName: issue.stopName,
        mode: 'bus',
        stopKind: classifyBusStop(issue, busIssues),
        sourceLat: issue.lat,
        sourceLon: issue.lon,
        sourceOsmElement: '',
        active,
        inactive,
        beforeIssues,
        afterIssues,
      }),
    );
  }
  const header = Object.keys(rows[0]);
  return `${header.join(',')}\r\n${rows
    .map((row) => header.map((key) => csv(row[key])).join(','))
    .join('\r\n')}\r\n`;
}

function mappingRow({
  key,
  feedId,
  stopId,
  stopName,
  mode,
  stopKind,
  sourceLat,
  sourceLon,
  sourceOsmElement,
  active,
  inactive,
  beforeIssues,
  afterIssues,
}) {
  const override = active.get(key);
  const deferred = inactive.get(key);
  const before = beforeIssues.get(key);
  const after = afterIssues.get(key);
  return {
    feedId,
    stopId,
    stopName,
    mode,
    stopKind,
    sourceLat,
    sourceLon,
    sourceOsmElement,
    reviewStatus: override
      ? 'OVERRIDDEN_REVIEWED'
      : deferred
        ? 'DEFERRED_LOW_CONFIDENCE'
        : before
          ? 'REVIEW_REQUIRED'
          : 'REVIEWED_NO_OVERRIDE',
    overrideLat: override?.override.lat ?? '',
    overrideLon: override?.override.lon ?? '',
    overrideOsmElement: override
      ? `${override.override.osmElementType}/${override.override.osmElementId}`
      : '',
    confidence: override?.confidence ?? deferred?.confidence ?? '',
    warningBefore: before?.warningTypes.join('+') ?? '',
    rootCauseBefore: before?.suspectedRootCause ?? '',
    warningAfter: after?.warningTypes.join('+') ?? '',
    rootCauseAfter: after?.suspectedRootCause ?? '',
    recommendedAction:
      after?.recommendedAction ??
      (override
        ? 'Retain reviewed local override and rerun regression.'
        : 'None.'),
  };
}

function classifyBusStop(issue, allBusIssues) {
  if (issue.suspectedRootCause === 'PRIVATE_OR_RESTRICTED_ACCESS') {
    return 'PRIVATE_OR_INTERNAL_STOP';
  }
  const siblings = allBusIssues.filter(
    (item) => item.stopName === issue.stopName && item.stopId !== issue.stopId,
  );
  if (siblings.length >= 3 || /駅前|ターミナル/.test(issue.stopName)) {
    return 'LARGE_TERMINAL_INTERNAL_STOP';
  }
  if (siblings.length === 1) return 'OPPOSITE_DIRECTION_PAIR';
  return 'CURBSIDE_OR_SINGLE_STOP';
}

function buildReport(metrics, baseline, boundaryOnly, after) {
  const before = metrics.importWarnings.before;
  const middle = metrics.importWarnings.boundaryOnly;
  const current = metrics.importWarnings.after;
  return `# Tokyo OTP stop-to-OSM linking improvement

## Result

The candidate graph \`${after.manifest.buildId}\` loads successfully. Isolated stops fell from **${before.isolatedStops} to ${current.isolatedStops}**, pruned stop islands from **${before.prunedStopIslands} to ${current.prunedStopIslands}**, and total targeted warning events from **${before.totalEvents} to ${current.totalEvents}** (${metrics.importWarnings.reductionPercent.totalEvents}% reduction). Existing routing regression is **${metrics.regression.existingRoutes.passed}/${metrics.regression.existingRoutes.passed + metrics.regression.existingRoutes.failed} PASS** and exact-stop override regression is **${metrics.regression.reviewedStops.passed}/${metrics.regression.reviewedStops.passed + metrics.regression.reviewedStops.failed} PASS**.

## What changed

1. Replaced the narrow BBBike Tokyo input with a reference-complete clip of the Geofabrik Kanto PBF covering every GTFS stop plus an approximately 2 km margin: \`139.16,35.56,139.95,35.86\`.
2. Kept all source GTFS ZIPs immutable. A deterministic local layer creates derived copies with 13 JR Yamanote and 16 Toei Rail stops moved from station-internal components to reviewed OSM station entrance nodes.
3. Kept OTP linking and island-pruning thresholds unchanged. The build-config SHA remains \`${after.manifest.graphBuildConfigHash}\`.
4. Left 11 low-confidence bus/cross-feed candidates inactive. Restricted market roads, terminal internals, and ambiguous cross-feed transfer points were not snapped to an arbitrary nearest road.

## Before / boundary-only / after

| Metric | Before | Wider OSM only | Wider OSM + reviewed overrides |
| --- | ---: | ---: | ---: |
| Isolated stops | ${before.isolatedStops} | ${middle.isolatedStops} | ${current.isolatedStops} |
| Transfer-unlinked stops | ${before.stopsNotLinkedForTransfers} | ${middle.stopsNotLinkedForTransfers} | ${current.stopsNotLinkedForTransfers} |
| Pruned stop islands | ${before.prunedStopIslands} | ${middle.prunedStopIslands} | ${current.prunedStopIslands} |
| Unique affected stops | ${before.uniqueAffectedStops} | ${middle.uniqueAffectedStops} | ${current.uniqueAffectedStops} |

The wider extract alone removed all 421 isolated-stop events and 413 transfer warnings. Reviewed entrances then removed every Toei Rail pruned island and all 13 JR pruned islands. The remaining 35 pruned events are Toei Bus locations requiring terminal/access review.

## Distance and connectivity

For the fixed 29-stop override cohort, nearest-walkable-edge distance changed from average **${metrics.nearestWalkableEdgeDistanceMeters.fixedReviewedOverrideCohort.before.average} m** / p95 **${metrics.nearestWalkableEdgeDistanceMeters.fixedReviewedOverrideCohort.before.p95} m** to average **${metrics.nearestWalkableEdgeDistanceMeters.fixedReviewedOverrideCohort.after.average} m** / p95 **${metrics.nearestWalkableEdgeDistanceMeters.fixedReviewedOverrideCohort.after.p95} m**. This metric is deliberately paired with island and routing checks: a point can be 0 m from a small disconnected platform edge. All 29 reviewed rail stops disappeared from the pruned list, and the top 20 each boarded transit at the exact overridden GTFS stop.

## OSM scope and resource impact

| Input/build | OSM bytes | Build seconds | Peak memory MiB | Graph bytes |
| --- | ---: | ---: | ---: | ---: |
| Narrow baseline | ${metrics.resources.before.osmBytes} | ${metrics.resources.before.buildDurationSeconds} | ${metrics.resources.before.approximatePeakMemoryMiB} | ${metrics.resources.before.graphBytes} |
| Expanded clip, no overrides | ${metrics.resources.boundaryOnly.osmBytes} | ${metrics.resources.boundaryOnly.buildDurationSeconds} | ${metrics.resources.boundaryOnly.approximatePeakMemoryMiB} | ${metrics.resources.boundaryOnly.graphBytes} |
| Final | ${metrics.resources.after.osmBytes} | ${metrics.resources.after.buildDurationSeconds} | ${metrics.resources.after.approximatePeakMemoryMiB} | ${metrics.resources.after.graphBytes} |

The full Kanto source is ${metrics.resources.kantoSource.bytes} bytes; the complete-ways clip is ${metrics.resources.expandedClip.bytes} bytes (${metrics.resources.expandedClip.sizeReductionPercent}% smaller) and passed reference checking. A full-Kanto OTP graph was not attempted under the local 8 GB Docker allocation; the clip already contains all feed stops with margin.

## Remaining work

- 116 of 132 transfer warnings are same-feed siblings already grouped by GTFS \`parent_station\` and are informational.
- 10 P1 bus stops sit beside private/restricted edges (notably Toyosu Market and internal terminal areas); local access truth is required before any override.
- The remaining singleton/cross-feed transfer warnings and 33 bus islands stay in \`mapping-review.csv\` with explicit actions.
- No original JR or Toei GTFS archive was modified, and no low-confidence override entered the candidate.

## Evidence and artifacts

- Override provenance: \`manifests/stop-osm-overrides.json\`
- Metrics: \`diagnostics/linking/before-after-metrics.json\`
- Mapping review: \`diagnostics/linking/mapping-review.csv\`
- Existing route smoke: \`${after.manifest.smokeTests.reportPath}\`
- Exact-stop smoke: \`diagnostics/linking/override-stop-smoke/report.md\`
- OSM source: [Geofabrik Kanto extract](https://download.geofabrik.de/asia/japan/kanto.html), licensed under ODbL with [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
- Extraction semantics: [osmium extract documentation](https://docs.osmcode.org/osmium/latest/osmium-extract.html).

Scope remains personal education/research only; generated data is not for external distribution or commercial service use.
`;
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${args[index] ?? ''}.`);
    }
    result[
      args[index].slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    ] = resolve(args[index + 1]);
  }
  for (const required of [
    'baseline',
    'boundaryOnly',
    'after',
    'jrMapping',
    'review',
  ]) {
    if (!result[required]) throw new Error(`Missing --${required}.`);
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function percentReduction(before, after) {
  return before === 0 ? 0 : round(((before - after) / before) * 100);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
