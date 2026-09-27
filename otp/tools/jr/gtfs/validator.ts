import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GtfsValidatorSummary } from './model.js';

const execFileAsync = promisify(execFile);

export interface MobilityDataValidatorOptions {
  datasetRoot: string;
  zipPath: string;
  outputDirectory: string;
  validatorVersion: string;
  dockerImage?: string;
}

export async function runMobilityDataValidator(
  options: MobilityDataValidatorOptions,
): Promise<GtfsValidatorSummary> {
  const datasetRoot = resolve(options.datasetRoot);
  const zipRelative = portableRelative(datasetRoot, resolve(options.zipPath));
  const outputRelative = portableRelative(
    datasetRoot,
    resolve(options.outputDirectory),
  );
  if (zipRelative.startsWith('../') || outputRelative.startsWith('../')) {
    throw new Error('Validator input and output must be inside datasetRoot');
  }
  const image =
    options.dockerImage ??
    `ghcr.io/mobilitydata/gtfs-validator:${options.validatorVersion}`;
  const args = [
    'run',
    '--rm',
    '--mount',
    `type=bind,source=${datasetRoot},target=/work`,
    image,
    '-i',
    `/work/${zipRelative}`,
    '-o',
    `/work/${outputRelative}`,
  ];
  await execFileAsync('docker', args, { maxBuffer: 10 * 1024 * 1024 });

  const reportJsonPath = resolve(options.outputDirectory, 'report.json');
  const reportPath = resolve(options.outputDirectory, 'report.html');
  await Promise.all([stat(reportJsonPath), stat(reportPath)]);
  const report = JSON.parse(await readFile(reportJsonPath, 'utf8')) as unknown;
  const notices = summarizeNotices(report);
  const errorCount = countBySeverity(notices, 'ERROR');
  const warningCount = countBySeverity(notices, 'WARNING');
  const infoCount = countBySeverity(notices, 'INFO');
  const warnings = notices
    .filter((notice) => notice.severity === 'WARNING')
    .map((notice) => ({
      code: notice.code,
      count: notice.count,
      otpImpact: classifyOtpImpact(notice.code),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
  const command = `docker ${args.map(shellDisplay).join(' ')}`;
  const reportedVersion = readReportedValidatorVersion(report);
  const summary: GtfsValidatorSummary = {
    validatorName: 'MobilityData GTFS Validator',
    validatorVersion:
      reportedVersion ?? options.validatorVersion.replace(/^v/, ''),
    command,
    errorCount,
    warningCount,
    infoCount,
    reportPath: portableRelative(datasetRoot, reportPath),
    reportJsonPath: portableRelative(datasetRoot, reportJsonPath),
    warnings,
  };
  if (errorCount > 0) {
    const error = new Error(
      `MobilityData GTFS Validator reported ${errorCount} error(s)`,
    );
    Object.assign(error, { validatorSummary: summary });
    throw error;
  }
  return summary;
}

function readReportedValidatorVersion(report: unknown): string | undefined {
  if (typeof report !== 'object' || report === null) return undefined;
  const summary = (report as Record<string, unknown>).summary;
  if (typeof summary !== 'object' || summary === null) return undefined;
  return stringValue((summary as Record<string, unknown>).validatorVersion);
}

interface NoticeSummary {
  code: string;
  severity: string;
  count: number;
}

export function summarizeNotices(report: unknown): NoticeSummary[] {
  const records: NoticeSummary[] = [];
  walk(report, records);
  const unique = new Map<string, NoticeSummary>();
  for (const record of records) {
    const key = `${record.severity}:${record.code}`;
    const previous = unique.get(key);
    if (!previous || record.count > previous.count) unique.set(key, record);
  }
  return [...unique.values()];
}

function walk(value: unknown, records: NoticeSummary[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => walk(child, records));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const object = value as Record<string, unknown>;
  const severity = stringValue(
    object.severity ?? object.level ?? object.noticeSeverity,
  )?.toUpperCase();
  const code = stringValue(
    object.code ?? object.noticeCode ?? object.type ?? object.noticeType,
  );
  const count = numberValue(
    object.totalNotices ?? object.count ?? object.total ?? object.noticeCount,
  );
  if (severity && code && ['ERROR', 'WARNING', 'INFO'].includes(severity)) {
    records.push({ code, severity, count: count ?? 1 });
  }
  Object.values(object).forEach((child) => walk(child, records));
}

function countBySeverity(notices: NoticeSummary[], severity: string): number {
  return notices
    .filter((notice) => notice.severity === severity)
    .reduce((total, notice) => total + notice.count, 0);
}

function classifyOtpImpact(code: string): 'none-known' | 'review' {
  const lower = code.toLowerCase();
  return /time|stop|trip|route|service|calendar/.test(lower)
    ? 'review'
    : 'none-known';
}

function portableRelative(parent: string, child: string): string {
  return relative(parent, child).replaceAll('\\', '/');
}

function shellDisplay(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
