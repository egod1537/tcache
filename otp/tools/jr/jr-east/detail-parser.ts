import {
  parseServiceDayTime,
  type RawArtifactManifest,
  type ServiceDayTime,
  type SourceReference,
} from '../common/index.js';
import { JrEastPipelineError } from './errors.js';
import {
  attribute,
  classTokens,
  firstHref,
  htmlText,
  parseRows,
} from './html.js';
import type {
  DetailTripCandidate,
  ParsedDetailStop,
  ParsedTrainDetail,
} from './model.js';

interface RawDetailStop {
  stationNameJa: string;
  sourceStationKey?: string;
  arrivalClock?: string;
  departureClock?: string;
  platform?: string;
  passThrough: boolean;
}

export class JrEastTrainDetailParser {
  readonly parserVersion = 'jr-east-train-detail/1.0.0';

  parse(html: string, manifest: RawArtifactManifest): ParsedTrainDetail {
    const table =
      /<table\b[^>]*id=["']tbl_train["'][^>]*>([\s\S]*?)<\/table>/i.exec(
        html,
      )?.[1];
    if (table === undefined) {
      throw new JrEastPipelineError(
        'PAGE_STRUCTURE_CHANGED',
        'Train detail table #tbl_train was not found',
        manifest.sourceUrl,
      );
    }
    const rows = parseRows(table);
    const trainRows = rows.filter((row) =>
      classTokens(row.className).includes('train'),
    );
    const trainTypeRow = trainRows.find((row) =>
      row.cells[0]?.text.includes('列車種別'),
    );
    const trainNumberRow = trainRows.find((row) =>
      row.cells[0]?.text.includes('列車番号'),
    );
    const trainTypes = trainTypeRow?.cells
      .filter((cell) => cell.tag === 'td')
      .map((cell) => cell.text);
    const trainNumbers = trainNumberRow?.cells
      .filter((cell) => cell.tag === 'td')
      .map((cell) => cell.text);
    if (
      trainTypes === undefined ||
      trainNumbers === undefined ||
      trainNumbers.length === 0 ||
      trainTypes.length !== trainNumbers.length
    ) {
      throw new JrEastPipelineError(
        'PAGE_STRUCTURE_CHANGED',
        'Train detail headers are missing or misaligned',
        manifest.sourceUrl,
      );
    }

    const rawStops = trainNumbers.map(() => [] as RawDetailStop[]);
    for (const row of rows.filter((candidate) =>
      classTokens(candidate.className).includes('time'),
    )) {
      const stationNameJa = row.cells[0]?.text ?? '';
      if (
        stationNameJa.length === 0 ||
        row.cells.length !== 1 + trainNumbers.length * 2
      ) {
        throw new JrEastPipelineError(
          'PAGE_STRUCTURE_CHANGED',
          `Malformed detail station row: ${stationNameJa || '(blank)'}`,
          manifest.sourceUrl,
        );
      }
      const href = firstHref(row.cells[0]?.html ?? '');
      const sourceStationKey =
        href === undefined ? undefined : /list(\d+)\.html/.exec(href)?.[1];
      for (let index = 0; index < trainNumbers.length; index += 1) {
        const timeCell = row.cells[1 + index * 2];
        const platformCell = row.cells[2 + index * 2];
        if (timeCell === undefined || platformCell === undefined) continue;
        const events = [
          ...timeCell.text.matchAll(/(\d{1,2}):(\d{2})\s*([着発])/g),
        ];
        const passThrough = /(?:通過|レ|↓)/.test(timeCell.text);
        if (events.length === 0 && !passThrough) continue;
        const arrival = events.find((event) => event[3] === '着');
        const departure = events.find((event) => event[3] === '発');
        rawStops[index]?.push({
          stationNameJa,
          ...(sourceStationKey === undefined ? {} : { sourceStationKey }),
          ...(arrival === undefined
            ? {}
            : { arrivalClock: `${arrival[1]}:${arrival[2]}` }),
          ...(departure === undefined
            ? {}
            : { departureClock: `${departure[1]}:${departure[2]}` }),
          ...(platformCell.text.length === 0
            ? {}
            : { platform: platformCell.text }),
          passThrough,
        });
      }
    }

    const notes = parseNotes(rows, trainNumbers.length);
    const sourceReference = makeSourceReference(manifest);
    const candidates: DetailTripCandidate[] = trainNumbers.map(
      (trainNumber, index) => {
        const stops = normalizeStops(
          rawStops[index] ?? [],
          trainNumber,
          manifest.sourceUrl,
        );
        if (stops.length < 2) {
          throw new JrEastPipelineError(
            'AMBIGUOUS_TRIP',
            `Detail train ${trainNumber} has fewer than two stops`,
            manifest.sourceUrl,
          );
        }
        return {
          trainNumber,
          trainType: trainTypes[index] ?? 'unknown',
          operationConditions: notes[index]?.length ? [notes[index]] : [],
          sourceReference,
          stops,
        };
      },
    );
    const explicitServiceDates = parseExplicitServiceDates(html);
    if (explicitServiceDates.length === 0) {
      throw new JrEastPipelineError(
        'CALENDAR_UNRESOLVED',
        'Train detail contains no explicit service dates',
        manifest.sourceUrl,
      );
    }
    return {
      candidates,
      calendarStart: explicitServiceDates[0]!,
      calendarEnd: explicitServiceDates.at(-1)!,
      explicitServiceDates,
      manifest,
    };
  }
}

function normalizeStops(
  rawStops: RawDetailStop[],
  trainNumber: string,
  sourceUrl: string,
): ParsedDetailStop[] {
  let dayOffset = 0;
  let previousMinutes: number | undefined;

  return rawStops.map((raw, sequence) => {
    const normalized: { arrival?: ServiceDayTime; departure?: ServiceDayTime } =
      {};
    for (const [event, clock] of [
      ['arrival', raw.arrivalClock],
      ['departure', raw.departureClock],
    ] as const) {
      if (clock === undefined) continue;
      const [hourText, minuteText] = clock.split(':');
      const hour = Number(hourText);
      const minute = Number(minuteText);
      let absoluteMinutes = dayOffset * 1_440 + hour * 60 + minute;
      if (previousMinutes !== undefined && absoluteMinutes < previousMinutes) {
        if (previousMinutes - absoluteMinutes <= 720) {
          throw new JrEastPipelineError(
            'TIME_ORDER_INVALID',
            `Detail time regressed for train ${trainNumber} at ${raw.stationNameJa}`,
            sourceUrl,
          );
        }
        dayOffset += 1;
        absoluteMinutes += 1_440;
      }
      previousMinutes = absoluteMinutes;
      normalized[event] = parseServiceDayTime(
        `${String(dayOffset * 24 + hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      );
    }
    return {
      stationNameJa: raw.stationNameJa,
      ...(raw.sourceStationKey === undefined
        ? {}
        : { sourceStationKey: raw.sourceStationKey }),
      sequence,
      ...normalized,
      ...(raw.platform === undefined ? {} : { platform: raw.platform }),
      passThrough: raw.passThrough,
    };
  });
}

function parseNotes(
  rows: ReturnType<typeof parseRows>,
  count: number,
): string[] {
  const row = rows.find((candidate) =>
    classTokens(candidate.className).includes('last'),
  );
  if (row === undefined) return Array.from({ length: count }, () => '');
  return row.cells.filter((cell) => cell.tag === 'td').map((cell) => cell.text);
}

function parseExplicitServiceDates(html: string): string[] {
  const dates = new Set<string>();
  for (const match of html.matchAll(
    /<table\b([^>]*)class=["'][^"']*calendar-month[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi,
  )) {
    const body = match[2] ?? '';
    const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(body)?.[1];
    const yearMonth =
      caption === undefined
        ? undefined
        : /(\d{4})年(\d{1,2})月/.exec(htmlText(caption));
    if (yearMonth == null) continue;
    for (const cell of body.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
      if (!classTokens(attribute(cell[1] ?? '', 'class')).includes('ok'))
        continue;
      const day = Number(htmlText(cell[2] ?? ''));
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      dates.add(
        `${yearMonth[1]}-${String(Number(yearMonth[2])).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      );
    }
  }
  return [...dates].sort();
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
