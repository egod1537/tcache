#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function prepareOverrides(diagnosis, review) {
  const issues = new Map(
    diagnosis.issues.map((issue) => [
      `${issue.feedId}::${issue.stopId}`,
      issue,
    ]),
  );
  const reviewedKeys = new Set(
    review.reviewedStops.map((item) => `${item.feedId}::${item.stopId}`),
  );
  const overrides = [];
  for (const item of review.reviewedStops) {
    const key = `${item.feedId}::${item.stopId}`;
    const issue = issues.get(key);
    if (!issue)
      throw new Error(`Reviewed stop is absent from diagnosis: ${key}`);
    if (
      !issue.warningTypes.some((type) =>
        ['PRUNED_STOP_ISLAND', 'ISOLATED_STOP'].includes(type),
      )
    ) {
      throw new Error(`Reviewed stop is neither pruned nor isolated: ${key}`);
    }
    const entrance = item.target ?? issue.nearestOsmEntrance;
    if (!entrance || entrance.elementType !== 'node') {
      throw new Error(`Reviewed stop has no OSM entrance node: ${key}`);
    }
    if (entrance.distanceMeters > review.maxEntranceDistanceMeters) {
      throw new Error(
        `Entrance for ${key} is ${entrance.distanceMeters}m away (limit ${review.maxEntranceDistanceMeters}m).`,
      );
    }
    overrides.push({
      feedId: issue.feedId,
      stopId: issue.stopId,
      stopName: issue.stopName,
      active: true,
      reviewed: true,
      confidence: 'high',
      reason: issue.warningTypes.includes('ISOLATED_STOP')
        ? 'GTFS point was isolated from the public street graph; snap to the reviewed public OSM station entrance.'
        : 'GTFS point linked to a pruned station-internal street component; snap to the reviewed public OSM station entrance.',
      sourceEvidence: `${review.osm.source}; PBF SHA-256 ${review.osm.sha256}; OSM node ${entrance.elementId} tagged railway=${entrance.tags.railway}; observed distance ${entrance.distanceMeters} m`,
      createdAt: review.createdAt,
      sourceBuildId: review.sourceBuildId,
      affectedBuildIds: review.affectedBuildIds ?? [],
      original: { lat: issue.lat, lon: issue.lon },
      override: {
        lat: entrance.lat,
        lon: entrance.lon,
        osmElementType: entrance.elementType,
        osmElementId: String(entrance.elementId),
        osmTags: entrance.tags,
      },
      reviewNote: item.reviewNote ?? null,
    });
  }
  for (const issue of diagnosis.issues) {
    const key = `${issue.feedId}::${issue.stopId}`;
    if (
      reviewedKeys.has(key) ||
      !['P0', 'P1'].includes(issue.priority) ||
      issue.suspectedRootCause === 'EXPECTED_WITHIN_PARENT_STATION'
    ) {
      continue;
    }
    overrides.push({
      feedId: issue.feedId,
      stopId: issue.stopId,
      stopName: issue.stopName,
      active: false,
      reviewed: false,
      confidence: 'low',
      reason:
        'No safe public-edge target was established; preserve the source coordinate pending local access review.',
      sourceEvidence: `Diagnosis ${diagnosis.buildId}: ${issue.suspectedRootCause}; nearest restricted edge ${issue.nearestRestrictedPedestrianEdge?.distanceMeters ?? 'n/a'} m`,
      createdAt: review.createdAt,
      sourceBuildId: review.sourceBuildId,
      affectedBuildIds: [],
      original: { lat: issue.lat, lon: issue.lon },
      override: null,
    });
  }
  overrides.sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      left.feedId.localeCompare(right.feedId) ||
      left.stopId.localeCompare(right.stopId),
  );
  return {
    schemaVersion: '1.0',
    generatedAt: review.createdAt,
    policy: {
      sourceGtfsImmutable: true,
      activeRequiresReviewedHighConfidence: true,
      thresholdTuningUsed: false,
      lowConfidenceIncludedInBuild: false,
    },
    feedSources: review.feedSources,
    osm: review.osm,
    sourceBuildId: review.sourceBuildId,
    affectedBuildIds: review.affectedBuildIds ?? [],
    summary: {
      activeReviewed: overrides.filter((item) => item.active).length,
      inactiveLowConfidence: overrides.filter((item) => !item.active).length,
    },
    overrides,
  };
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${args[index] ?? ''}.`);
    }
    result[args[index].slice(2)] = args[index + 1];
  }
  for (const required of ['diagnosis', 'review', 'output']) {
    if (!result[required]) throw new Error(`Missing --${required}.`);
  }
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, resolve(value)]),
  );
}

async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const [diagnosis, review] = await Promise.all([
    readFile(paths.diagnosis, 'utf8').then(JSON.parse),
    readFile(paths.review, 'utf8').then(JSON.parse),
  ]);
  const result = prepareOverrides(diagnosis, review);
  await mkdir(dirname(paths.output), { recursive: true });
  await writeFile(paths.output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output: paths.output, summary: result.summary }, null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
