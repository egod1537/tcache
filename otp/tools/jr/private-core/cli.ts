import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Bytes } from '../common/index.js';
import { adaptOdptStationTimetables } from './odpt-adapter.js';
import { PRIVATE_OPERATOR_CONFIGS } from './profiles.js';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const operator = PRIVATE_OPERATOR_CONFIGS[options.operator];
  const paths = {
    railways: join(options.rawDirectory, 'railways.json'),
    stations: join(options.rawDirectory, 'stations.json'),
    stationTimetables: join(options.rawDirectory, 'station-timetables.json'),
  };
  const [railwayBytes, stationBytes, timetableBytes] = await Promise.all([
    readFile(paths.railways),
    readFile(paths.stations),
    readFile(paths.stationTimetables),
  ]);
  const baseUrl = 'https://api-challenge.odpt.org/api/v4';
  const result = adaptOdptStationTimetables({
    operator,
    railways: JSON.parse(railwayBytes.toString('utf8')) as unknown,
    stations: JSON.parse(stationBytes.toString('utf8')) as unknown,
    stationTimetables: JSON.parse(timetableBytes.toString('utf8')) as unknown,
    sourceArtifactHashes: [railwayBytes, stationBytes, timetableBytes].map(
      sha256Bytes,
    ),
    sourceUrls: {
      railways: `${baseUrl}/odpt:Railway?odpt:operator=${operator.sourceOperator}`,
      stations: `${baseUrl}/odpt:Station?odpt:operator=${operator.sourceOperator}`,
      stationTimetables: `${baseUrl}/odpt:StationTimetable?odpt:operator=${operator.sourceOperator}`,
    },
    sourceEdition: options.sourceEdition,
    serviceStartDate: options.serviceStartDate,
    serviceEndDate: options.serviceEndDate,
    generatedAt: options.generatedAt,
  });
  const normalizedDirectory = join(options.outputDirectory, 'normalized');
  await mkdir(normalizedDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(normalizedDirectory, 'dataset.json'),
      `${canonicalJson(result.dataset)}\n`,
      { flag: 'wx' },
    ),
    writeFile(
      join(options.outputDirectory, 'station-mapping-review.json'),
      `${canonicalJson(result.mappingCandidates)}\n`,
      { flag: 'wx' },
    ),
    writeFile(
      join(options.outputDirectory, 'adapter-diagnostics.json'),
      `${canonicalJson(result.diagnostics)}\n`,
      { flag: 'wx' },
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        operator: options.operator,
        datasetVersion: result.dataset.metadata.datasetVersion,
        lines: result.dataset.lines.length,
        stations: result.dataset.stations.length,
        trips: result.dataset.trips.length,
        mappingStatus: 'REVIEW_REQUIRED',
      },
      null,
      2,
    )}\n`,
  );
}

interface Options {
  operator: keyof typeof PRIVATE_OPERATOR_CONFIGS;
  rawDirectory: string;
  outputDirectory: string;
  sourceEdition: string;
  serviceStartDate: string;
  serviceEndDate: string;
  generatedAt: string;
}

function parseArguments(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    values.set(key.slice(2), value);
  }
  const operator = values.get('operator');
  if (!['tokyu', 'odakyu', 'keikyu', 'seibu'].includes(operator ?? '')) {
    throw new Error('--operator must be tokyu, odakyu, keikyu, or seibu');
  }
  for (const required of [
    'raw-directory',
    'output-directory',
    'source-edition',
    'service-start-date',
    'service-end-date',
  ]) {
    if (!values.get(required)) throw new Error(`--${required} is required`);
  }
  return {
    operator: operator as keyof typeof PRIVATE_OPERATOR_CONFIGS,
    rawDirectory: resolve(values.get('raw-directory')!),
    outputDirectory: resolve(values.get('output-directory')!),
    sourceEdition: values.get('source-edition')!,
    serviceStartDate: values.get('service-start-date')!,
    serviceEndDate: values.get('service-end-date')!,
    generatedAt: values.get('generated-at') ?? new Date().toISOString(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
