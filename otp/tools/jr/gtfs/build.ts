import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  canonicalJson,
  hashCanonicalJson,
  sha256Bytes,
  sha256Text,
  type NormalizedTimetable,
  type StationMappingSet,
} from '../common/index.js';
import { generateGtfsFeed } from './generator.js';
import {
  REQUIRED_GTFS_FILES,
  type GtfsBuildManifest,
  type GtfsGeneratorConfig,
  type GtfsValidatorSummary,
} from './model.js';

const REPRODUCIBLE_ZIP_MTIME = new Date('2000-01-01T00:00:00.000Z');

export interface GtfsBuildResult {
  gtfsDirectory: string;
  zipPath: string;
  manifestPath: string;
  manifest: GtfsBuildManifest;
}

export async function buildGtfs(input: {
  datasetRoot: string;
  dataset: NormalizedTimetable;
  stationMappingSet: StationMappingSet;
  config: GtfsGeneratorConfig;
  generatedAt?: string;
  zipName?: string;
}): Promise<GtfsBuildResult> {
  const generated = generateGtfsFeed(input);
  const gtfsDirectory = join(input.datasetRoot, 'gtfs');
  await mkdir(gtfsDirectory, { recursive: true });

  for (const name of REQUIRED_GTFS_FILES) {
    await writeFile(
      join(gtfsDirectory, name),
      generated.files.get(name)!,
      'utf8',
    );
  }

  const zippable = Object.fromEntries(
    REQUIRED_GTFS_FILES.map((name) => [
      name,
      strToU8(generated.files.get(name)!),
    ]),
  );
  const zipBytes = zipSync(zippable, {
    level: 9,
    mtime: REPRODUCIBLE_ZIP_MTIME,
  });
  const zipName = input.zipName ?? 'feed.gtfs.zip';
  const zipPath = join(gtfsDirectory, zipName);
  await writeFile(zipPath, zipBytes);

  const stationMappingHash = hashCanonicalJson(input.stationMappingSet);
  const manifest: GtfsBuildManifest = {
    schemaVersion: '1.0',
    datasetVersion: input.dataset.metadata.datasetVersion,
    feedVersion: generated.feedVersion,
    generatorVersion: input.config.generatorVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    normalizedManifestHash: input.dataset.metadata.manifestHash,
    normalizedSourceArtifactHashes: [
      ...input.dataset.metadata.sourceArtifactHashes,
    ].sort(),
    stationMapping: {
      sha256: stationMappingHash,
      source: input.stationMappingSet.source,
      confirmedMappings: input.stationMappingSet.mappings.filter(
        (mapping) => mapping.mappingStatus === 'confirmed',
      ).length,
    },
    canonicalContentHash: generated.canonicalContentHash,
    zipSha256: sha256Bytes(zipBytes),
    files: REQUIRED_GTFS_FILES.map((name) => {
      const content = generated.files.get(name)!;
      return {
        name,
        sha256: sha256Text(content),
        bytes: Buffer.byteLength(content, 'utf8'),
      };
    }),
    counts: generated.counts,
    directionPolicy: { ...input.config.directionIds },
    unresolvedCalendarConditions: generated.unresolvedCalendarConditions,
    scope: {
      purpose: 'personal-education-and-research',
      externalDistribution: false,
      commercialUse: false,
    },
  };
  const manifestPath = join(gtfsDirectory, 'manifest.json');
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, 'utf8');
  await augmentDatasetManifest(input.datasetRoot, manifest);
  return { gtfsDirectory, zipPath, manifestPath, manifest };
}

export async function attachValidatorSummary(
  result: GtfsBuildResult,
  validator: GtfsValidatorSummary,
): Promise<GtfsBuildResult> {
  const manifest = { ...result.manifest, validator };
  await writeFile(result.manifestPath, `${canonicalJson(manifest)}\n`, 'utf8');
  await augmentDatasetManifest(join(result.gtfsDirectory, '..'), manifest);
  return { ...result, manifest };
}

async function augmentDatasetManifest(
  datasetRoot: string,
  manifest: GtfsBuildManifest,
): Promise<void> {
  const path = join(datasetRoot, 'manifest.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const relativeReport = manifest.validator?.reportPath;
  const rootManifest = {
    ...existing,
    gtfsBuild: {
      ...manifest,
      ...(manifest.validator && relativeReport
        ? {
            validator: {
              ...manifest.validator,
              reportPath: relativeReport,
            },
          }
        : {}),
      manifestPath: `gtfs/${basename(join(datasetRoot, 'gtfs', 'manifest.json'))}`,
    },
  };
  await writeFile(path, `${canonicalJson(rootManifest)}\n`, 'utf8');
}
