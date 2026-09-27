import type { RawArtifactManifest } from '../common/index.js';
import { JrEastPipelineError } from './errors.js';
import { classTokens, firstHref, htmlText, parseRows } from './html.js';
import type {
  JrEastSource,
  ObservedEdition,
  SourceDiscovery,
  YamanoteService,
} from './model.js';
import {
  getJrEastLineDefinition,
  type JrEastLineDefinition,
} from './line-registry.js';

export const JR_EAST_TIMETABLE_ROOT = 'https://timetables.jreast.co.jp/';
export const TOKYO_STATION_INDEX_URL =
  'https://timetables.jreast.co.jp/timetable/list1039.html';

export function discoverEdition(
  html: string,
  sourceUrl: string,
): ObservedEdition {
  const announce = /announce_INIT\(([\s\S]*?)\);/.exec(html)?.[1];
  if (announce === undefined) {
    throw new JrEastPipelineError(
      'PAGE_STRUCTURE_CHANGED',
      'The official edition declaration was not found',
      sourceUrl,
    );
  }
  const quoted = [...announce.matchAll(/'([^']*)'/g)].map(
    (match) => match[1] ?? '',
  );
  const observedRawEditionKey = quoted.find((value) => /^\d{3,8}$/.test(value));
  if (observedRawEditionKey === undefined) {
    throw new JrEastPipelineError(
      'CALENDAR_UNRESOLVED',
      'An observed raw edition key was not explicitly declared',
      sourceUrl,
    );
  }
  const evidence =
    quoted.find((value) => value.includes('JR時刻表')) ?? announce.trim();
  const label = /「JR時刻表」([^。]+?)(?:に基づ|$)/.exec(evidence)?.[1]?.trim();
  return {
    observedRawEditionKey,
    ...(label === undefined ? {} : { humanReadableLabel: label }),
    evidence,
  };
}

export function discoverYamanoteSources(
  html: string,
  manifest: RawArtifactManifest,
  expectedEdition: ObservedEdition,
): SourceDiscovery {
  return discoverLineSources(
    html,
    manifest,
    expectedEdition,
    getJrEastLineDefinition('yamanote'),
  );
}

export function discoverLineSources(
  html: string,
  manifest: RawArtifactManifest,
  expectedEdition: ObservedEdition,
  line: JrEastLineDefinition,
): SourceDiscovery {
  const pageEdition = discoverEdition(html, manifest.sourceUrl);
  if (
    pageEdition.observedRawEditionKey !== expectedEdition.observedRawEditionKey
  ) {
    throw new JrEastPipelineError(
      'PARSE_FAILED',
      `Edition changed between discovery pages (${expectedEdition.observedRawEditionKey} vs ${pageEdition.observedRawEditionKey})`,
      manifest.sourceUrl,
    );
  }

  const sources: JrEastSource[] = [];
  for (const row of parseRows(html)) {
    if (row.cells[0]?.text !== line.sourceLineName) continue;
    const directionLabel = row.cells[1]?.text ?? '';
    const direction = parseDirection(directionLabel, manifest.sourceUrl, line);
    for (const cell of row.cells.slice(2)) {
      const href = firstHref(cell.html);
      if (href === undefined) continue;
      const service = serviceFromCell(
        cell.className,
        cell.text,
        manifest.sourceUrl,
      );
      const absoluteUrl = new URL(href, manifest.sourceUrl).href;
      const existing = sources.find(
        (source) =>
          source.direction === direction && source.service === service,
      );
      const isMatrix = absoluteUrl.includes('/timetable-v/');
      if (existing === undefined) {
        sources.push({
          lineKey: line.lineKey,
          direction,
          service,
          directionLabel,
          serviceLabel: service === 'weekday' ? '平日' : '土曜・休日',
          matrixUrl: isMatrix ? absoluteUrl : '',
          stationTimetableUrl: isMatrix ? '' : absoluteUrl,
        });
      } else if (isMatrix) {
        existing.matrixUrl = absoluteUrl;
      } else {
        existing.stationTimetableUrl = absoluteUrl;
      }
    }
  }

  const completeSources = sources.filter(
    (source) =>
      source.matrixUrl.length > 0 && source.stationTimetableUrl.length > 0,
  );
  const expectedSourceCount = line.directions.length * 2;
  if (completeSources.length !== expectedSourceCount) {
    throw new JrEastPipelineError(
      'PAGE_STRUCTURE_CHANGED',
      `Expected ${expectedSourceCount} ${line.lineKey} direction/service sources, found ${completeSources.length}`,
      manifest.sourceUrl,
    );
  }
  return {
    edition: pageEdition,
    sourceIndexUrl: manifest.sourceUrl,
    sources: completeSources,
  };
}

export function discoverDetailUrls(
  html: string,
  sourceUrl: string,
  hourFrom: number,
  hourTo: number,
  limit: number,
): string[] {
  const result: string[] = [];
  for (const row of parseRows(html)) {
    const hourMatch = /^time_(\d{1,2})$/.exec(
      attributeFromRow(row.attributes, 'id'),
    );
    if (hourMatch === null) continue;
    const hour = Number(hourMatch[1]);
    if (hour < hourFrom || hour > hourTo) continue;
    for (const href of [
      ...row.html.matchAll(
        /<a\b([^>]*)class=["'][^"']*time_link[^"']*["'][^>]*>/gi,
      ),
    ]) {
      const rawHref = attributeFromRow(href[1] ?? '', 'href');
      if (rawHref.length === 0) continue;
      result.push(new URL(rawHref, sourceUrl).href);
      if (result.length >= limit) return result;
    }
  }
  return [...new Set(result)];
}

function parseDirection(
  value: string,
  sourceUrl: string,
  line: JrEastLineDefinition,
): string {
  const matched = line.directions.find((direction) =>
    value.includes(direction.sourceLabelIncludes),
  );
  if (matched) return matched.id;
  throw new JrEastPipelineError(
    'PAGE_STRUCTURE_CHANGED',
    `Unrecognized ${line.lineKey} direction label: ${htmlText(value)}`,
    sourceUrl,
  );
}

function serviceFromCell(
  className: string,
  text: string,
  sourceUrl: string,
): YamanoteService {
  const classes = classTokens(className);
  if (classes.includes('weekday') || text.includes('平日')) return 'weekday';
  if (classes.includes('holiday') || text.includes('休日')) return 'holiday';
  throw new JrEastPipelineError(
    'PAGE_STRUCTURE_CHANGED',
    `Unrecognized timetable service label: ${text}`,
    sourceUrl,
  );
}

function attributeFromRow(attributes: string, name: string): string {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}
