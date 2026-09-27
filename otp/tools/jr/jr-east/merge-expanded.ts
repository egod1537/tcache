import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NORMALIZED_SCHEMA_VERSION,
  canonicalJson,
  createDatasetMetadata,
  parseNormalizedTimetable,
  validateNormalizedTimetable,
  type NormalizedTimetable,
} from '../common/index.js';

const MERGER_VERSION = 'jr-east-expanded-merge/1.0.0';
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const datasets = await Promise.all(
    options.datasetRoots.map(async (root) => ({
      root,
      dataset: parseNormalizedTimetable(
        JSON.parse(
          await readFile(join(root, 'normalized', 'dataset.json'), 'utf8'),
        ),
      ),
    })),
  );
  const merged = mergeDatasets(
    datasets.map((input) => input.dataset),
    new Date().toISOString(),
  );
  const issues = validateNormalizedTimetable(merged);
  if (issues.length > 0) {
    throw new Error(
      `Merged normalized data is invalid: ${canonicalJson(issues)}`,
    );
  }
  const datasetRoot = join(options.outputRoot, merged.metadata.datasetVersion);
  const normalizedRoot = join(datasetRoot, 'normalized');
  await mkdir(normalizedRoot, { recursive: true });
  await Promise.all([
    writeJson(join(normalizedRoot, 'dataset.json'), merged),
    writeJson(join(normalizedRoot, 'stations.json'), merged.stations),
    writeJson(join(normalizedRoot, 'lines.json'), merged.lines),
    writeJson(join(normalizedRoot, 'calendars.json'), merged.serviceCalendars),
    writeJson(join(normalizedRoot, 'trips.json'), merged.trips),
    writeJson(join(datasetRoot, 'validation-report.json'), {
      schemaVersion: '1.0',
      status: 'PASS',
      lineCount: merged.lines.length,
      stationCount: merged.stations.length,
      tripCount: merged.trips.length,
      issues,
    }),
    writeJson(join(datasetRoot, 'manifest.json'), {
      schemaVersion: '1.0',
      datasetVersion: merged.metadata.datasetVersion,
      mergerVersion: MERGER_VERSION,
      sourceDatasets: datasets.map(({ root, dataset }) => ({
        datasetVersion: dataset.metadata.datasetVersion,
        path: root,
        lineIds: dataset.lines.map((line) => line.id),
        sourceArtifactHashes: dataset.metadata.sourceArtifactHashes,
      })),
      scope: {
        purpose: 'personal-education-and-research',
        externalDistribution: false,
        commercialUse: false,
      },
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        datasetRoot,
        datasetVersion: merged.metadata.datasetVersion,
        lines: merged.lines.length,
        stations: merged.stations.length,
        trips: merged.trips.length,
        validationStatus: 'PASS',
      },
      null,
      2,
    )}\n`,
  );
}

export function mergeDatasets(
  datasets: NormalizedTimetable[],
  generatedAt: string,
): NormalizedTimetable {
  if (datasets.length === 0)
    throw new Error('At least one dataset is required');
  const editions = new Set(
    datasets.map((dataset) => dataset.metadata.timetableEdition),
  );
  if (editions.size !== 1) {
    throw new Error('JR East expanded datasets must use one timetable edition');
  }
  const merged = {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    metadata: createDatasetMetadata(
      {
        operator: 'jr-east',
        timetableEdition: [...editions][0]!,
        sourceArtifactHashes: [
          ...new Set(
            datasets.flatMap(
              (dataset) => dataset.metadata.sourceArtifactHashes,
            ),
          ),
        ],
        parserVersion: `${MERGER_VERSION}+${[
          ...new Set(datasets.map((dataset) => dataset.metadata.parserVersion)),
        ]
          .sort()
          .join('+')}`,
      },
      generatedAt,
    ),
    operators: uniqueById(datasets.flatMap((dataset) => dataset.operators)),
    lines: uniqueById(datasets.flatMap((dataset) => dataset.lines)),
    stations: uniqueById(datasets.flatMap((dataset) => dataset.stations)),
    serviceCalendars: uniqueById(
      datasets.flatMap((dataset) => dataset.serviceCalendars),
    ),
    trips: uniqueById(
      datasets.flatMap((dataset) => dataset.trips),
      'internalTripId',
    ),
  };
  return parseNormalizedTimetable(merged);
}

function uniqueById<T extends object>(
  values: T[],
  key: keyof T = 'id' as keyof T,
): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = String(value[key]);
    const existing = result.get(id);
    if (existing && canonicalJson(existing) !== canonicalJson(value)) {
      throw new Error(`Conflicting merged record: ${id}`);
    }
    result.set(id, value);
  }
  return [...result.values()].sort((left, right) =>
    String(left[key]).localeCompare(String(right[key])),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalJson(value)}\n`, 'utf8');
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    const value = args[index + 1];
    if (!argument?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument: ${argument ?? ''}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  const datasets = values.get('datasets');
  if (!datasets) throw new Error('--datasets is required');
  return {
    datasetRoots: datasets.split(',').map(resolveRepositoryPath),
    outputRoot: resolveRepositoryPath(
      values.get('output-root') ??
        fileURLToPath(
          new URL(
            '../../../data/japan/tokyo/jr-east/expanded/',
            import.meta.url,
          ),
        ),
    ),
  };
}

function resolveRepositoryPath(path: string): string {
  return isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
