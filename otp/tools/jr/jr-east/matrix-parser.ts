import {
  parseServiceDayTime,
  type RawArtifactManifest,
  type ServiceDayTime,
  type SourceReference,
} from '../common/index.js';
import { JrEastPipelineError } from './errors.js';
import {
  classTokens,
  extractTableByClass,
  firstHref,
  htmlText,
  parseRows,
  type HtmlRow,
} from './html.js';
import type {
  MatrixTripCandidate,
  ParsedMatrixPage,
  ParsedMatrixStop,
  PipelineDiagnostic,
  YamanoteDirection,
  YamanoteService,
} from './model.js';

interface StationMatrixRow {
  stationNameJa: string;
  sourceStationKey?: string;
  event: 'arrival' | 'departure';
  values: string[];
}

export class YamanoteMatrixParser {
  readonly parserVersion = 'jr-east-yamanote-matrix/1.0.0';

  parse(html: string, manifest: RawArtifactManifest): ParsedMatrixPage {
    const table = extractTableByClass(html, 'paper_table', manifest.sourceUrl);
    const rows = parseRows(table);
    const trainRow = findRow(rows, 'tableTr_trainNumber', manifest.sourceUrl);
    const trainTypeRow = findRow(rows, 'tableTr_trainName', manifest.sourceUrl);
    const operatingDayRow = findRow(
      rows,
      'tableTr_operatingDay',
      manifest.sourceUrl,
    );
    const trainNumbers = dataValues(trainRow);
    const trainTypes = dataValues(trainTypeRow);
    const operatingConditions = dataValues(operatingDayRow);
    if (
      trainNumbers.length === 0 ||
      trainTypes.length !== trainNumbers.length ||
      operatingConditions.length !== trainNumbers.length
    ) {
      throw new JrEastPipelineError(
        'PAGE_STRUCTURE_CHANGED',
        'Matrix header columns are missing or misaligned',
        manifest.sourceUrl,
      );
    }

    const directionLabel = headingText(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const serviceLabel = headingText(
      html,
      /<h3\b[^>]*class=["'][^"']*(?:weekday|holiday)[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
    );
    const direction = parseDirection(directionLabel, manifest.sourceUrl);
    const service = parseService(serviceLabel, manifest.sourceUrl);
    const stationRows = rows
      .filter((row) => isStationRow(row))
      .map((row) =>
        parseStationRow(row, trainNumbers.length, manifest.sourceUrl),
      );
    if (stationRows.length < 2) {
      throw new JrEastPipelineError(
        'PAGE_STRUCTURE_CHANGED',
        'Matrix contains fewer than two station rows',
        manifest.sourceUrl,
      );
    }

    const sourceReference = makeSourceReference(manifest);
    const diagnostics: PipelineDiagnostic[] = [];
    const candidates: MatrixTripCandidate[] = [];
    for (
      let columnIndex = 0;
      columnIndex < trainNumbers.length;
      columnIndex += 1
    ) {
      const trainNumber = trainNumbers[columnIndex]?.trim() ?? '';
      if (trainNumber.length === 0) continue;
      const stops = parseColumnStops(
        stationRows,
        columnIndex,
        trainNumber,
        manifest.sourceUrl,
      );
      if (stops.length < 2) {
        diagnostics.push({
          code: 'AMBIGUOUS_TRIP',
          severity: 'warning',
          message: `Column ${columnIndex} (${trainNumber}) has fewer than two observable stops`,
          sourceUrl: manifest.sourceUrl,
        });
        continue;
      }
      candidates.push({
        trainNumber,
        trainType: trainTypes[columnIndex]?.trim() || 'unknown',
        operationCondition:
          operatingConditions[columnIndex]?.trim() || serviceLabel,
        direction,
        service,
        columnIndex,
        sourceReference,
        stops,
      });
    }

    reportDuplicateSignatures(candidates, diagnostics, manifest.sourceUrl);
    const uniqueStationCount = new Set(
      stationRows.map((row) => row.stationNameJa),
    ).size;
    if (stationRows.length > uniqueStationCount + 1) {
      diagnostics.push({
        code: 'AMBIGUOUS_TRIP',
        severity: 'warning',
        message: `Matrix shows ${stationRows.length} rows for ${uniqueStationCount} unique stations; more than one circuit may be present`,
        sourceUrl: manifest.sourceUrl,
      });
    }
    return {
      direction,
      directionLabel,
      service,
      serviceLabel,
      stationRowCount: stationRows.length,
      candidates,
      diagnostics,
      manifest,
    };
  }
}

function parseColumnStops(
  rows: StationMatrixRow[],
  columnIndex: number,
  trainNumber: string,
  sourceUrl: string,
): ParsedMatrixStop[] {
  const pending: Array<{
    row: StationMatrixRow;
    rawTime?: string;
    passThrough: boolean;
  }> = [];
  for (const row of rows) {
    const value = row.values[columnIndex]?.trim() ?? '';
    if (value.length === 0 || value === '＝' || value === '=') continue;
    if (/^(?:レ|通過|↓|\|\|)$/.test(value)) {
      pending.push({ row, passThrough: true });
    } else if (/^\d{3,4}$/.test(value)) {
      pending.push({
        row,
        rawTime: value.padStart(4, '0'),
        passThrough: false,
      });
    } else {
      throw new JrEastPipelineError(
        'PARSE_FAILED',
        `Unexpected matrix cell "${value}" for train ${trainNumber}`,
        sourceUrl,
      );
    }
  }

  let previousMinutes: number | undefined;
  let dayOffset = 0;
  return pending.map((item, sequence) => {
    let time: ServiceDayTime | undefined;
    if (item.rawTime !== undefined) {
      const hour = Number(item.rawTime.slice(0, 2));
      const minute = Number(item.rawTime.slice(2));
      let absoluteMinutes = dayOffset * 1_440 + hour * 60 + minute;
      if (previousMinutes !== undefined && absoluteMinutes < previousMinutes) {
        if (previousMinutes - absoluteMinutes <= 720) {
          throw new JrEastPipelineError(
            'TIME_ORDER_INVALID',
            `Time regressed within train ${trainNumber} at ${item.row.stationNameJa}`,
            sourceUrl,
          );
        }
        dayOffset += 1;
        absoluteMinutes += 1_440;
      }
      previousMinutes = absoluteMinutes;
      time = parseServiceDayTime(
        `${String(dayOffset * 24 + hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      );
    }
    return {
      stationNameJa: item.row.stationNameJa,
      ...(item.row.sourceStationKey === undefined
        ? {}
        : { sourceStationKey: item.row.sourceStationKey }),
      sequence,
      ...(item.row.event === 'arrival' && time !== undefined
        ? { arrival: time }
        : {}),
      ...(item.row.event === 'departure' && time !== undefined
        ? { departure: time }
        : {}),
      passThrough: item.passThrough,
    };
  });
}

function parseStationRow(
  row: HtmlRow,
  columnCount: number,
  sourceUrl: string,
): StationMatrixRow {
  const stationNameJa = row.cells[0]?.text ?? '';
  const eventText = row.cells[1]?.text ?? '';
  const event = eventText.includes('着')
    ? 'arrival'
    : eventText.includes('発')
      ? 'departure'
      : undefined;
  const values = row.cells.slice(2).map((cell) => cell.text);
  if (
    stationNameJa.length === 0 ||
    event === undefined ||
    values.length !== columnCount
  ) {
    throw new JrEastPipelineError(
      'PAGE_STRUCTURE_CHANGED',
      `Malformed station matrix row: ${stationNameJa || '(blank)'}`,
      sourceUrl,
    );
  }
  const href = firstHref(row.cells[0]?.html ?? '');
  const sourceStationKey =
    href === undefined ? undefined : /list(\d+)\.html/.exec(href)?.[1];
  return {
    stationNameJa,
    ...(sourceStationKey === undefined ? {} : { sourceStationKey }),
    event,
    values,
  };
}

function isStationRow(row: HtmlRow): boolean {
  if (row.cells.length < 3 || row.cells[0]?.tag !== 'th') return false;
  if (classTokens(row.className).some((name) => name.startsWith('tableTr_')))
    return false;
  const event = row.cells[1]?.text ?? '';
  return event.includes('発') || event.includes('着');
}

function findRow(
  rows: HtmlRow[],
  className: string,
  sourceUrl: string,
): HtmlRow {
  const row = rows.find((candidate) =>
    classTokens(candidate.className).includes(className),
  );
  if (row === undefined) {
    throw new JrEastPipelineError(
      'PAGE_STRUCTURE_CHANGED',
      `Expected matrix row .${className} was not found`,
      sourceUrl,
    );
  }
  return row;
}

function dataValues(row: HtmlRow): string[] {
  return row.cells.filter((cell) => cell.tag === 'td').map((cell) => cell.text);
}

function headingText(html: string, pattern: RegExp): string {
  return htmlText(pattern.exec(html)?.[1] ?? '');
}

function parseDirection(value: string, sourceUrl: string): YamanoteDirection {
  if (value.includes('外回り')) return 'outer';
  if (value.includes('内回り')) return 'inner';
  throw new JrEastPipelineError(
    'PAGE_STRUCTURE_CHANGED',
    'Matrix direction is missing',
    sourceUrl,
  );
}

function parseService(value: string, sourceUrl: string): YamanoteService {
  if (value.includes('平日')) return 'weekday';
  if (value.includes('休日')) return 'holiday';
  throw new JrEastPipelineError(
    'CALENDAR_UNRESOLVED',
    'Matrix service label is missing',
    sourceUrl,
  );
}

function makeSourceReference(manifest: RawArtifactManifest): SourceReference {
  return {
    artifactSha256: manifest.sha256,
    sourceUrl: manifest.sourceUrl,
    sourceType: manifest.sourceType,
    sourceEdition: manifest.sourceEdition,
    sourceUrlKey: new URL(manifest.sourceUrl).pathname.split('/').at(-1) ?? '',
  };
}

function reportDuplicateSignatures(
  candidates: MatrixTripCandidate[],
  diagnostics: PipelineDiagnostic[],
  sourceUrl: string,
): void {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const first = candidate.stops[0];
    const departure = first?.departure ?? first?.arrival;
    const signature = `${candidate.trainNumber}|${first?.stationNameJa}|${JSON.stringify(departure)}`;
    if (seen.has(signature)) {
      diagnostics.push({
        code: 'AMBIGUOUS_TRIP',
        severity: 'error',
        message: `Duplicate train signature cannot be disambiguated: ${signature}`,
        sourceUrl,
      });
    }
    seen.add(signature);
  }
}
