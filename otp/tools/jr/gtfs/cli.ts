import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNormalizedTimetable,
  parseStationMappingSet,
} from '../common/index.js';
import { attachValidatorSummary, buildGtfs } from './build.js';
import { JR_EAST_YAMANOTE_GTFS_CONFIG } from './profiles.js';
import { runMobilityDataValidator } from './validator.js';

const DEFAULT_MAPPING_PATH = fileURLToPath(
  new URL(
    '../../../data/japan/tokyo/jr-east/mappings/yamanote-osm-reviewed.json',
    import.meta.url,
  ),
);

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const datasetPath = join(options.datasetRoot, 'normalized', 'dataset.json');
  const [datasetInput, stationMappingInput] = await Promise.all([
    readJson<unknown>(datasetPath),
    readJson<unknown>(options.mappingPath),
  ]);
  const dataset = parseNormalizedTimetable(datasetInput);
  const stationMappingSet = parseStationMappingSet(stationMappingInput);
  let result = await buildGtfs({
    datasetRoot: options.datasetRoot,
    dataset,
    stationMappingSet,
    config: JR_EAST_YAMANOTE_GTFS_CONFIG,
    zipName: 'jr-east-yamanote.gtfs.zip',
  });
  if (!options.skipValidator) {
    const validator = await runMobilityDataValidator({
      datasetRoot: options.datasetRoot,
      zipPath: result.zipPath,
      outputDirectory: join(options.datasetRoot, 'validator'),
      validatorVersion: options.validatorVersion,
    });
    result = await attachValidatorSummary(result, validator);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        datasetVersion: dataset.metadata.datasetVersion,
        feedVersion: result.manifest.feedVersion,
        gtfsDirectory: result.gtfsDirectory,
        zipPath: result.zipPath,
        canonicalContentHash: result.manifest.canonicalContentHash,
        zipSha256: result.manifest.zipSha256,
        counts: result.manifest.counts,
        validator: result.manifest.validator,
      },
      null,
      2,
    )}\n`,
  );
}

interface CliOptions {
  datasetRoot: string;
  mappingPath: string;
  skipValidator: boolean;
  validatorVersion: string;
}

function parseArguments(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help') {
      printHelp();
      process.exit(0);
    }
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  const datasetRoot = values.get('dataset-root');
  if (!datasetRoot) throw new Error('--dataset-root is required');
  const skipValidator = values.get('skip-validator') ?? 'false';
  if (!['true', 'false'].includes(skipValidator)) {
    throw new Error('--skip-validator must be true or false');
  }
  return {
    datasetRoot: resolve(datasetRoot),
    mappingPath: resolve(values.get('mapping') ?? DEFAULT_MAPPING_PATH),
    skipValidator: skipValidator === 'true',
    validatorVersion: values.get('validator-version') ?? '8.0.1',
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function printHelp(): void {
  process.stdout.write(`Normalized JR timetable to GTFS Schedule\n\n`);
  process.stdout.write(`  --dataset-root PATH           required\n`);
  process.stdout.write(
    `  --mapping PATH                reviewed station mapping JSON\n`,
  );
  process.stdout.write(`  --validator-version VERSION   default: 8.0.1\n`);
  process.stdout.write(`  --skip-validator true|false   default: false\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
