#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  haversineMeters,
  loadGtfsFeeds,
  modeFor,
  normalizeStationName,
  round,
  scopedId,
} from './lib.mjs';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function scoreCandidate(left, right) {
  const distanceMeters = haversineMeters(left, right);
  const leftName = normalizeStationName(left.stopName);
  const rightName = normalizeStationName(right.stopName);
  const exactNormalizedName = Boolean(leftName) && leftName === rightName;
  const nameContained =
    Boolean(leftName && rightName) &&
    (leftName.includes(rightName) || rightName.includes(leftName));
  const descriptionReference =
    String(left.stopDesc ?? '').includes(right.stopName) ||
    String(right.stopDesc ?? '').includes(left.stopName);
  const distanceScore = Math.max(0, 1 - distanceMeters / 500) * 0.3;
  const score =
    (exactNormalizedName ? 0.55 : nameContained ? 0.25 : 0) +
    distanceScore +
    (descriptionReference ? 0.15 : 0);
  return {
    score: round(Math.min(1, score), 3),
    distanceMeters: round(distanceMeters),
    evidence: {
      exactNormalizedName,
      normalizedNames: [leftName, rightName],
      descriptionReference,
      stationCodes: [left.stopCode || null, right.stopCode || null],
      osmStationRelation: 'NOT_EVALUATED_AUTOMATICALLY',
      lineContext: [left.mode, right.mode],
    },
  };
}

export function expandReviewedComplex(review, feedById) {
  const expanded = [];
  for (const requested of review.members) {
    const feed = feedById.get(requested.feedId);
    if (!feed)
      throw new Error(`${review.id}: unknown feed ${requested.feedId}.`);
    const requestedStop = requested.stopId ?? requested.stationCode;
    if (!requestedStop) {
      throw new Error(`${review.id}: member has no stopId or stationCode.`);
    }
    const stop = resolveRequestedStop(feed, requestedStop);
    if (!stop) {
      throw new Error(
        `${review.id}: unknown stop ${requested.feedId}:${requestedStop}.`,
      );
    }
    const ids = [stop.stop_id];
    if (requested.includeChildren) {
      ids.push(...(feed.childrenByParent.get(stop.stop_id) ?? []));
    }
    for (const stopId of ids) {
      const memberStop = feed.stopById.get(stopId);
      const childTypes = (feed.childrenByParent.get(stopId) ?? []).flatMap(
        (childId) => [...(feed.routeTypesByStop.get(childId) ?? [])],
      );
      const types = feed.routeTypesByStop.get(stopId) ?? new Set(childTypes);
      expanded.push({
        feedId: feed.feedId,
        stopId,
        scopedStopId: scopedId(feed.feedId, stopId),
        stopName: memberStop.stop_name,
        officialNameJa: memberStop.stop_name,
        officialNameEn: requested.officialNameEn ?? null,
        stopCode: memberStop.stop_code || null,
        parentStation: memberStop.parent_station || null,
        locationType: Number(memberStop.location_type || 0),
        mode: modeFor(types, feed.feedId),
        lat: Number(memberStop.stop_lat),
        lon: Number(memberStop.stop_lon),
        entranceRelation: requested.entranceRelation ?? {
          status: 'ROUTING_VALIDATION_REQUIRED',
          osmElementType: null,
          osmElementId: null,
        },
        confidence: requested.confidence ?? review.confidence,
        reviewed: true,
      });
    }
  }
  const unique = new Map(expanded.map((item) => [item.scopedStopId, item]));
  return [...unique.values()].sort((a, b) =>
    a.scopedStopId.localeCompare(b.scopedStopId),
  );
}

function resolveRequestedStop(feed, stopIdOrCode) {
  const direct = feed.stopById.get(stopIdOrCode);
  if (direct) return direct;
  const byCode = feed.stops.filter((stop) => stop.stop_code === stopIdOrCode);
  if (byCode.length > 1) {
    throw new Error(
      `${feed.feedId}: station code ${stopIdOrCode} matches multiple stops.`,
    );
  }
  return byCode[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const outputDir = resolve(
    options.outputDir ?? `${buildRoot}/diagnostics/transfers`,
  );
  const [feeds, reviewText, buildManifest] = await Promise.all([
    loadGtfsFeeds(buildRoot),
    readFile(resolveRepositoryPath(options.reviewConfig), 'utf8'),
    readFile(`${buildRoot}/manifests/build-manifest.json`, 'utf8').then(
      JSON.parse,
    ),
  ]);
  const reviewConfig = JSON.parse(reviewText);
  const feedById = new Map(feeds.map((feed) => [feed.feedId, feed]));
  const reviewedComplexes = reviewConfig.complexes.map((review) => {
    const members = expandReviewedComplex(review, feedById);
    const centroid = {
      lat: round(
        members.reduce((sum, member) => sum + member.lat, 0) / members.length,
        7,
      ),
      lon: round(
        members.reduce((sum, member) => sum + member.lon, 0) / members.length,
        7,
      ),
    };
    const maximumMemberDistanceMeters = round(
      Math.max(...members.map((member) => haversineMeters(member, centroid))),
    );
    if (maximumMemberDistanceMeters > review.maxMemberDistanceMeters) {
      throw new Error(
        `${review.id}: member is ${maximumMemberDistanceMeters}m from centroid; reviewed maximum is ${review.maxMemberDistanceMeters}m.`,
      );
    }
    return {
      stationComplexId: review.id,
      officialNameJa: review.officialNameJa,
      officialNameEn: review.officialNameEn ?? null,
      status: 'REVIEWED',
      confidence: review.confidence,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
      centroid,
      maximumMemberDistanceMeters,
      matchEvidence: review.matchEvidence,
      walkPathReview: review.walkPathReview,
      members,
    };
  });
  const acceptedPairs = new Set();
  for (const complex of reviewedComplexes) {
    for (const left of complex.members) {
      for (const right of complex.members) {
        acceptedPairs.add(
          [left.scopedStopId, right.scopedStopId].sort().join('|'),
        );
      }
    }
  }
  const candidateStops = feeds.flatMap((feed) =>
    feed.stops
      .filter(
        (stop) =>
          feed.feedId !== 'jp-tokyo-toei-bus' ||
          Number(stop.location_type || 0) === 1,
      )
      .map((stop) => {
        const childTypes = (
          feed.childrenByParent.get(stop.stop_id) ?? []
        ).flatMap((childId) => [...(feed.routeTypesByStop.get(childId) ?? [])]);
        return {
          feedId: feed.feedId,
          stopId: stop.stop_id,
          scopedStopId: scopedId(feed.feedId, stop.stop_id),
          stopName: stop.stop_name,
          stopDesc: stop.stop_desc,
          stopCode: stop.stop_code,
          mode: modeFor(
            feed.routeTypesByStop.get(stop.stop_id) ?? new Set(childTypes),
            feed.feedId,
          ),
          lat: Number(stop.stop_lat),
          lon: Number(stop.stop_lon),
        };
      }),
  );
  const automaticCandidates = [];
  for (let leftIndex = 0; leftIndex < candidateStops.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidateStops.length;
      rightIndex += 1
    ) {
      const left = candidateStops[leftIndex];
      const right = candidateStops[rightIndex];
      if (
        left.feedId === right.feedId &&
        left.feedId !== 'jp-tokyo-toei-rail'
      ) {
        continue;
      }
      const pairId = [left.scopedStopId, right.scopedStopId].sort().join('|');
      if (acceptedPairs.has(pairId)) continue;
      const match = scoreCandidate(left, right);
      if (match.distanceMeters > 500 || match.score < 0.55) continue;
      automaticCandidates.push({
        candidateId: createHash('sha256')
          .update(pairId)
          .digest('hex')
          .slice(0, 16),
        status: 'REVIEW_REQUIRED',
        autoMerged: false,
        confidence: match.score >= 0.8 ? 'MEDIUM' : 'LOW',
        score: match.score,
        distanceMeters: match.distanceMeters,
        evidence: match.evidence,
        members: [pickCandidateMember(left), pickCandidateMember(right)],
      });
    }
  }
  automaticCandidates.sort(
    (a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters,
  );
  const generatedAt = new Date().toISOString();
  const map = {
    schemaVersion: '1.0',
    generatedAt,
    buildId: buildManifest.buildId,
    policy: {
      namesAloneNeverAutoMerge: true,
      automaticCandidatesAreRoutingInactive: true,
      reviewedComplexesDoNotConsolidateOtpStops: true,
      crossFeedTransfersUseOsmPedestrianGraph: true,
    },
    summary: {
      reviewedComplexes: reviewedComplexes.length,
      reviewedMembers: reviewedComplexes.reduce(
        (sum, complex) => sum + complex.members.length,
        0,
      ),
      crossFeedComplexes: reviewedComplexes.filter(
        (complex) =>
          new Set(complex.members.map((member) => member.feedId)).size > 1,
      ).length,
      automaticCandidatesRequiringReview: automaticCandidates.length,
    },
    complexes: reviewedComplexes,
    automaticCandidates,
  };
  const rules = {
    schemaVersion: '1.0',
    generatedAt,
    policy: {
      defaultAction: 'USE_OSM_PATH',
      sourceGtfsModified: false,
      stopConsolidationEnabled: false,
      syntheticZeroSecondTransfersAllowed: false,
    },
    rules: reviewedComplexes.map((complex) => ({
      stationComplexId: complex.stationComplexId,
      action: 'USE_OSM_PATH',
      createGtfsTransfer: false,
      minimumTransferTimeSeconds: null,
      reason:
        'Preserve real pedestrian routing; add an explicit rule only after a reproducible path failure and manual review.',
      reviewed: true,
      reviewedAt: complex.reviewedAt,
    })),
    explicitRules: reviewConfig.explicitRules ?? [],
  };
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      `${outputDir}/station-complex-map.json`,
      `${JSON.stringify(map, null, 2)}\n`,
    ),
    writeFile(
      `${outputDir}/transfer-rules.json`,
      `${JSON.stringify(rules, null, 2)}\n`,
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ outputDir, ...map.summary, explicitRules: rules.explicitRules.length }, null, 2)}\n`,
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

function pickCandidateMember(item) {
  return {
    feedId: item.feedId,
    stopId: item.stopId,
    scopedStopId: item.scopedStopId,
    stopName: item.stopName,
    stopCode: item.stopCode || null,
    mode: item.mode,
    lat: item.lat,
    lon: item.lon,
  };
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    reviewConfig: 'otp/config/station-complex-review.json',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] =
      args[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
