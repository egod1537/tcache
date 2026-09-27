import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JrEastPipelineError } from './errors.js';
import type { YamanoteDirection, YamanoteService } from './model.js';
import {
  runYamanotePipeline,
  type YamanotePipelineOptions,
} from './pipeline.js';

const DEFAULT_OUTPUT_ROOT = fileURLToPath(
  new URL('../../../data/japan/tokyo/jr-east/yamanote/', import.meta.url),
);

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  try {
    const result = await runYamanotePipeline(options);
    process.stdout.write(
      `${JSON.stringify(
        {
          datasetRoot: result.datasetRoot,
          datasetVersion: result.datasetVersion,
          validationStatus: result.validationReport.status,
          trips: result.validationReport.tripCount,
          stations: result.validationReport.stationCount,
          conflicts: result.conflicts.length,
        },
        null,
        2,
      )}\n`,
    );
    if (result.validationReport.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    const failure = {
      status: 'FAILED',
      code: error instanceof JrEastPipelineError ? error.code : 'PARSE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      sourceUrl:
        error instanceof JrEastPipelineError ? error.sourceUrl : undefined,
      failedAt: new Date().toISOString(),
    };
    const failureDirectory = join(options.outputRoot, 'failures');
    await mkdir(failureDirectory, { recursive: true });
    const failurePath = join(
      failureDirectory,
      `${failure.failedAt.replace(/[:.]/g, '-')}.json`,
    );
    await writeFile(
      failurePath,
      `${JSON.stringify(failure, null, 2)}\n`,
      'utf8',
    );
    process.stderr.write(
      `${JSON.stringify({ ...failure, failurePath }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}

export function parseArguments(args: string[]): YamanotePipelineOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help') {
      printHelp();
      process.exit(0);
    }
    if (argument?.startsWith('--') !== true) {
      throw new Error(`Unexpected argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }

  const mode = enumValue(values.get('mode') ?? 'sample', [
    'sample',
    'full-yamanote',
  ]);
  const defaultDirection = mode === 'sample' ? 'outer' : 'both';
  const defaultService = mode === 'sample' ? 'weekday' : 'both';
  const maxTripsValue = values.get('max-trips');
  return {
    mode,
    directions: expandDirection(
      enumValue(values.get('direction') ?? defaultDirection, [
        'outer',
        'inner',
        'both',
      ]),
    ),
    services: expandService(
      enumValue(values.get('service') ?? defaultService, [
        'weekday',
        'holiday',
        'both',
      ]),
    ),
    ...(mode === 'sample' || maxTripsValue !== undefined
      ? { maxTrips: integer(maxTripsValue ?? '2', 'max-trips', 1) }
      : {}),
    maxDetails: integer(
      values.get('max-details') ?? (mode === 'sample' ? '1' : '4'),
      'max-details',
      1,
    ),
    hourFrom: integer(
      values.get('hour-from') ?? (mode === 'sample' ? '4' : '0'),
      'hour-from',
      0,
      23,
    ),
    hourTo: integer(values.get('hour-to') ?? '23', 'hour-to', 0, 23),
    outputRoot: values.get('output-root') ?? DEFAULT_OUTPUT_ROOT,
    collector: {
      userAgent:
        values.get('user-agent') ??
        'tcache-tokyo-otp-research/1.0 (personal educational PoC; local use)',
      requestDelayMs: integer(values.get('delay-ms') ?? '750', 'delay-ms', 0),
      timeoutMs: integer(
        values.get('timeout-ms') ?? '15000',
        'timeout-ms',
        100,
      ),
      maxAttempts: integer(
        values.get('max-attempts') ?? '3',
        'max-attempts',
        1,
        5,
      ),
    },
  };
}

function enumValue<const T extends string>(
  value: string,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Expected one of ${allowed.join(', ')}, received ${value}`);
  }
  return value as T;
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `--${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function expandDirection(
  value: YamanoteDirection | 'both',
): YamanoteDirection[] {
  return value === 'both' ? ['outer', 'inner'] : [value];
}

function expandService(value: YamanoteService | 'both'): YamanoteService[] {
  return value === 'both' ? ['weekday', 'holiday'] : [value];
}

function printHelp(): void {
  process.stdout.write(`JR East Yamanote collector/parser PoC\n\n`);
  process.stdout.write(`  --mode sample|full-yamanote\n`);
  process.stdout.write(`  --direction outer|inner|both\n`);
  process.stdout.write(`  --service weekday|holiday|both\n`);
  process.stdout.write(`  --max-trips N --max-details N\n`);
  process.stdout.write(`  --hour-from H --hour-to H\n`);
  process.stdout.write(`  --delay-ms N --timeout-ms N --max-attempts N\n`);
  process.stdout.write(`  --output-root PATH --user-agent TEXT\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
