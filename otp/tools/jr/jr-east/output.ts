import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FileSystemRawArtifactStore,
  canonicalJson,
  type CollectedResponse,
  type NormalizedTimetable,
} from '../common/index.js';
import type { RequestLogEntry } from './collector.js';
import type {
  ConflictRecord,
  ObservedEdition,
  PipelineDiagnostic,
} from './model.js';

export interface YamanoteRunManifest {
  schemaVersion: '1.0';
  datasetVersion: string;
  operator: 'jr-east';
  line: string;
  edition: ObservedEdition;
  mode: 'sample' | 'full-line' | 'full-yamanote';
  collectorVersion: string;
  parserVersions: string[];
  generatedAt: string;
  sourceArtifacts: Array<{
    sourceUrl: string;
    sourceType: string;
    sha256: string;
    requestedAt: string;
  }>;
}

export interface ValidationReport {
  status: 'PASS' | 'FAIL';
  generatedAt: string;
  tripCount: number;
  stationCount: number;
  diagnostics: PipelineDiagnostic[];
}

export async function writeYamanoteOutput(input: {
  outputRoot: string;
  dataset: NormalizedTimetable;
  responses: CollectedResponse[];
  collectorVersion: string;
  runManifest: YamanoteRunManifest;
  conflicts: ConflictRecord[];
  validationReport: ValidationReport;
  requestLog: RequestLogEntry[];
}): Promise<string> {
  const datasetRoot = join(
    input.outputRoot,
    input.dataset.metadata.datasetVersion,
  );
  const normalizedRoot = join(datasetRoot, 'normalized');
  await mkdir(normalizedRoot, { recursive: true });

  const rawStore = new FileSystemRawArtifactStore(datasetRoot);
  for (const response of input.responses) {
    await rawStore.put(response, input.collectorVersion);
  }

  await Promise.all([
    writeJson(join(normalizedRoot, 'stations.json'), input.dataset.stations),
    writeJson(join(normalizedRoot, 'lines.json'), input.dataset.lines),
    writeJson(
      join(normalizedRoot, 'calendars.json'),
      input.dataset.serviceCalendars,
    ),
    writeJson(join(normalizedRoot, 'trips.json'), input.dataset.trips),
    writeJson(join(normalizedRoot, 'dataset.json'), input.dataset),
    writeJson(join(datasetRoot, 'manifest.json'), input.runManifest),
    writeJson(join(datasetRoot, 'conflicts.json'), input.conflicts),
    writeJson(
      join(datasetRoot, 'validation-report.json'),
      input.validationReport,
    ),
    writeJson(join(datasetRoot, 'request-log.json'), input.requestLog),
  ]);
  return datasetRoot;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalJson(value)}\n`, 'utf8');
}
