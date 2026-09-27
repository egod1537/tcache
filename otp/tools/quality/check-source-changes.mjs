#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function evaluateSourceChanges(
  registry,
  snapshot,
  baseline,
  policy,
  now = new Date(),
) {
  const failures = [];
  const warnings = [];
  const expectedFeedIds = registry.feeds.map((feed) => feed.feedId);
  const currentByFeed = new Map(
    (snapshot?.feeds ?? []).map((feed) => [feed.feedId, feed]),
  );
  const baselineByFeed = new Map(
    (baseline?.feeds ?? []).map((feed) => [feed.feedId, feed]),
  );

  if (policy.requireApprovedBaseline && baseline?.reviewStatus !== 'APPROVED') {
    failures.push(
      failure(
        'SOURCE_BASELINE_NOT_APPROVED',
        'Source baseline is missing or has not been explicitly approved.',
      ),
    );
  }
  const results = registry.feeds.map((registered) => {
    const current = currentByFeed.get(registered.feedId);
    const before = baselineByFeed.get(registered.feedId);
    const feedFailures = [];
    const feedWarnings = [];
    if (!current) {
      feedFailures.push(
        failure(
          'SOURCE_SNAPSHOT_MISSING',
          'Current source snapshot is missing.',
        ),
      );
      failures.push(
        ...feedFailures.map((item) => ({
          ...item,
          feedId: registered.feedId,
        })),
      );
      return feedResult(registered, current, feedFailures, feedWarnings);
    }
    if (!before) {
      feedFailures.push(
        failure(
          'SOURCE_BASELINE_FEED_MISSING',
          'Feed is absent from baseline.',
        ),
      );
    }
    if (
      registered.currentSourceStatus === 'BLOCKED_SOURCE' ||
      registered.sourceType === 'unresolved' ||
      !registered.adapterVersion
    ) {
      feedFailures.push(
        failure(
          'SOURCE_CONTRACT_UNRESOLVED',
          'Registry has no approved machine-readable source adapter.',
        ),
      );
    }
    if (!/^[a-f0-9]{64}$/u.test(current.sourceSha256 ?? '')) {
      feedFailures.push(
        failure(
          'SOURCE_SHA_INVALID',
          'sourceSha256 must be a SHA-256 hex value.',
        ),
      );
    }
    if (!/^[a-f0-9]{64}$/u.test(current.gtfsSha256 ?? '')) {
      feedFailures.push(
        failure('GTFS_SHA_INVALID', 'gtfsSha256 must be a SHA-256 hex value.'),
      );
    }
    const collectedAt = Date.parse(current.collectedAt ?? '');
    const sourceAgeHours = Number.isFinite(collectedAt)
      ? (now.getTime() - collectedAt) / 3_600_000
      : null;
    if (sourceAgeHours === null || sourceAgeHours < 0) {
      feedFailures.push(
        failure('SOURCE_DATE_INVALID', 'collectedAt is missing or invalid.'),
      );
    } else if (sourceAgeHours > policy.maximumSourceAgeHours) {
      feedFailures.push(
        failure(
          'SOURCE_STALE',
          `Source age ${round(sourceAgeHours)}h exceeds ${policy.maximumSourceAgeHours}h.`,
        ),
      );
    }
    if (!current.sourceEdition?.observedRawKey && !current.gtfsVersion) {
      feedFailures.push(
        failure(
          'SOURCE_VERSION_MISSING',
          'Neither an observed timetable edition nor GTFS version is recorded.',
        ),
      );
    }
    if (current.parserStructureVersion !== registered.adapterVersion) {
      feedFailures.push(
        failure(
          'PARSER_STRUCTURE_UNREGISTERED',
          `Parser structure ${current.parserStructureVersion ?? 'missing'} does not equal registered ${registered.adapterVersion ?? 'unresolved'}.`,
        ),
      );
    }
    if (
      (current.validatorErrorCount ?? Number.POSITIVE_INFINITY) >
      policy.validatorErrorsMax
    ) {
      feedFailures.push(
        failure(
          'GTFS_VALIDATOR_ERROR',
          `Validator errors ${current.validatorErrorCount ?? 'missing'} exceed ${policy.validatorErrorsMax}.`,
        ),
      );
    }
    if (!Number.isInteger(current.stationCount) || current.stationCount < 1) {
      feedFailures.push(
        failure(
          'STATION_COUNT_INVALID',
          'stationCount must be a positive integer.',
        ),
      );
    }
    if (
      !Number.isFinite(current.parseCoverage) ||
      current.parseCoverage < policy.minimumParseCoverage ||
      current.parseCoverage > 1
    ) {
      feedFailures.push(
        failure(
          'PARSE_COVERAGE_INVALID',
          `Parse coverage ${current.parseCoverage ?? 'missing'} is outside [${policy.minimumParseCoverage}, 1].`,
        ),
      );
    }
    if (before) {
      const changed =
        current.sourceSha256 !== before.sourceSha256 ||
        current.gtfsSha256 !== before.gtfsSha256 ||
        current.gtfsVersion !== before.gtfsVersion ||
        current.sourceEdition?.observedRawKey !==
          before.sourceEdition?.observedRawKey;
      if (
        changed &&
        policy.requireReviewForSourceHashChange &&
        !isApprovedChange(current.reviewedChange, before.sourceSha256)
      ) {
        feedFailures.push(
          failure(
            'SOURCE_CHANGE_REVIEW_REQUIRED',
            'Source hash/edition/version changed without an approval tied to the previous SHA.',
          ),
        );
      }
      if (
        policy.requireExactParserStructureVersion &&
        current.parserStructureVersion !== before.parserStructureVersion
      ) {
        feedFailures.push(
          failure(
            'PARSER_STRUCTURE_CHANGED',
            `Parser structure changed from ${before.parserStructureVersion} to ${current.parserStructureVersion}.`,
          ),
        );
      }
      if (
        Number.isFinite(before.stationCount) &&
        Number.isFinite(current.stationCount)
      ) {
        const stationDeltaRatio =
          Math.abs(current.stationCount - before.stationCount) /
          before.stationCount;
        if (stationDeltaRatio > policy.maximumStationCountRelativeChange) {
          feedFailures.push(
            failure(
              'STATION_COUNT_ANOMALY',
              `Station count changed by ${round(stationDeltaRatio * 100)}%.`,
            ),
          );
        }
      }
      if (
        Number.isFinite(before.parseCoverage) &&
        Number.isFinite(current.parseCoverage) &&
        before.parseCoverage - current.parseCoverage >
          policy.maximumParseCoverageDecrease
      ) {
        feedFailures.push(
          failure(
            'PARSE_COVERAGE_REGRESSION',
            `Parse coverage fell from ${before.parseCoverage} to ${current.parseCoverage}.`,
          ),
        );
      }
    }
    failures.push(
      ...feedFailures.map((item) => ({ ...item, feedId: registered.feedId })),
    );
    warnings.push(
      ...feedWarnings.map((item) => ({ ...item, feedId: registered.feedId })),
    );
    return feedResult(registered, current, feedFailures, feedWarnings, {
      sourceAgeHours: sourceAgeHours === null ? null : round(sourceAgeHours),
    });
  });

  for (const feedId of currentByFeed.keys()) {
    if (!expectedFeedIds.includes(feedId)) {
      failures.push(
        failure(
          'UNREGISTERED_FEED',
          `Snapshot contains unregistered ${feedId}.`,
          {
            feedId,
          },
        ),
      );
    }
  }
  return {
    schemaVersion: '1.0',
    evaluatedAt: now.toISOString(),
    registryVersion: registry.registryVersion,
    baselineId: baseline?.baselineId ?? null,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    expectedFeedCount: registry.requiredFeedCount,
    observedFeedCount: currentByFeed.size,
    failures,
    warnings,
    feeds: results,
  };
}

function isApprovedChange(review, previousSha) {
  return (
    review?.status === 'APPROVED' &&
    review.previousSourceSha256 === previousSha &&
    Boolean(review.reviewedAt) &&
    Boolean(review.reviewedBy) &&
    Boolean(review.reason)
  );
}

function feedResult(registered, current, failures, warnings, extra = {}) {
  return {
    feedId: registered.feedId,
    operator: registered.operator,
    sourceStatus: registered.currentSourceStatus,
    datasetVersion:
      current?.gtfsVersion ?? current?.sourceEdition?.observedRawKey ?? null,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    warnings,
    ...extra,
  };
}

function failure(code, message, details = undefined) {
  return { code, message, ...(details ? { details } : {}) };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [registry, snapshot, baseline, policy] = await Promise.all([
    readJson(resolveRepositoryPath(options.registry)),
    readJson(resolveRepositoryPath(options.snapshot)),
    readJson(resolveRepositoryPath(options.baseline)),
    readJson(resolveRepositoryPath(options.policy)),
  ]);
  const result = evaluateSourceChanges(registry, snapshot, baseline, policy);
  const output = resolveRepositoryPath(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, ...result }, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    registry: 'otp/config/tokyo-rail-production-registry.json',
    policy: 'otp/config/tokyo-rail-source-change-policy.json',
    snapshot:
      'otp/data/japan/tokyo/builds/candidate/manifests/source-snapshot.json',
    baseline: 'otp/baselines/tokyo-rail-sources.json',
    output: 'otp/data/japan/tokyo/builds/candidate/quality/source-change.json',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[
      key
        .slice(2)
        .replace(/-([a-z])/g, (_, character) => character.toUpperCase())
    ] = args[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
