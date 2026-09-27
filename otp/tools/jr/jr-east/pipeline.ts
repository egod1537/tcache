import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  NORMALIZED_SCHEMA_VERSION,
  createDatasetMetadata,
  createLineId,
  createRawArtifactManifest,
  createStationId,
  createTripId,
  parseNormalizedTimetable,
  serviceDaySeconds,
  validateNormalizedTimetable,
  type CollectedResponse,
  type NormalizedTimetable,
  type RawArtifactManifest,
  type ServiceCalendar,
  type ServiceDayTime,
  type Station,
  type Trip,
} from '../common/index.js';
import {
  JrEastHttpCollector,
  type JrEastCollectorOptions,
} from './collector.js';
import { JrEastTrainDetailParser } from './detail-parser.js';
import { JrEastPipelineError } from './errors.js';
import { getJrEastLineDefinition } from './line-registry.js';
import { YamanoteMatrixParser } from './matrix-parser.js';
import type {
  ConflictRecord,
  MatrixTripCandidate,
  ObservedEdition,
  ParsedMatrixPage,
  ParsedTrainDetail,
  PipelineDiagnostic,
  YamanoteService,
  JrEastSource,
} from './model.js';
import {
  type ValidationReport,
  type YamanoteRunManifest,
  writeYamanoteOutput,
} from './output.js';
import { reconcileMatrixWithDetails } from './reconcile.js';
import {
  JR_EAST_TIMETABLE_ROOT,
  discoverDetailUrls,
  discoverEdition,
  discoverLineSources,
} from './source-discovery.js';

const OPERATOR_ID = 'jr-east';

export interface YamanotePipelineOptions {
  lineKey: string;
  mode: 'sample' | 'full-line' | 'full-yamanote';
  directions: string[];
  services: YamanoteService[];
  maxTrips?: number;
  maxDetails: number;
  hourFrom: number;
  hourTo: number;
  outputRoot: string;
  collector: JrEastCollectorOptions;
}

export interface YamanotePipelineResult {
  datasetRoot: string;
  datasetVersion: string;
  validationReport: ValidationReport;
  conflicts: ConflictRecord[];
}

interface FetchedPage {
  response: CollectedResponse;
  manifest: RawArtifactManifest;
  html: string;
}

export async function runYamanotePipeline(
  options: YamanotePipelineOptions,
): Promise<YamanotePipelineResult> {
  validateOptions(options);
  const line = getJrEastLineDefinition(options.lineKey);
  if (options.mode !== 'sample') await requireSampleMarker(options.outputRoot);

  const collector = new JrEastHttpCollector(options.collector);
  const responses: CollectedResponse[] = [];
  const rootResponse = await collector.collect(
    request(JR_EAST_TIMETABLE_ROOT, 'edition-index-html', 'observed-on-page'),
  );
  const rootHtml = decode(rootResponse.body);
  const edition = discoverEdition(rootHtml, rootResponse.request.sourceUrl);
  rootResponse.request.sourceEdition = edition.observedRawEditionKey;
  responses.push(rootResponse);

  const indexResponse = await collector.collect(
    request(
      line.sourceIndexUrl,
      'station-index-html',
      edition.observedRawEditionKey,
    ),
  );
  const indexPage = page(indexResponse, collector.collectorVersion);
  responses.push(indexResponse);
  const discovery = discoverLineSources(
    indexPage.html,
    indexPage.manifest,
    edition,
    line,
  );
  const selectedSources = discovery.sources.filter(
    (source) =>
      options.directions.includes(source.direction) &&
      options.services.includes(source.service),
  );

  const matrixParser = new YamanoteMatrixParser();
  const detailParser = new JrEastTrainDetailParser();
  const matrixPages: ParsedMatrixPage[] = [];
  const stationPages: Array<{ source: JrEastSource; page: FetchedPage }> = [];
  for (const source of selectedSources) {
    const matrixResponse = await collector.collect(
      request(
        source.matrixUrl,
        `${line.lineKey}-matrix-html`,
        edition.observedRawEditionKey,
      ),
    );
    const matrixPage = page(matrixResponse, collector.collectorVersion);
    responses.push(matrixResponse);
    const direction = line.directions.find(
      (candidate) => candidate.id === source.direction,
    );
    if (!direction) {
      throw new JrEastPipelineError(
        'PAGE_STRUCTURE_CHANGED',
        `Direction ${source.direction} is not registered for ${line.lineKey}`,
        source.matrixUrl,
      );
    }
    matrixPages.push(
      matrixParser.parse(matrixPage.html, matrixPage.manifest, {
        lineKey: line.lineKey,
        direction: source.direction,
        service: source.service,
        matrixHeadingIncludes: direction.matrixHeadingIncludes,
      }),
    );

    const stationResponse = await collector.collect(
      request(
        source.stationTimetableUrl,
        'station-timetable-html',
        edition.observedRawEditionKey,
      ),
    );
    const stationPage = page(stationResponse, collector.collectorVersion);
    responses.push(stationResponse);
    stationPages.push({ source, page: stationPage });
  }

  const detailTargets = stationPages
    .flatMap(({ source, page: stationPage }) =>
      discoverDetailUrls(
        stationPage.html,
        stationPage.manifest.sourceUrl,
        options.hourFrom,
        options.hourTo,
        1,
      ).map((url) => ({ url, source })),
    )
    .slice(0, options.maxDetails);
  if (detailTargets.length === 0) {
    throw new JrEastPipelineError(
      'CALENDAR_UNRESOLVED',
      'No train detail page was selected; explicit calendar evidence is required',
    );
  }

  const details: ParsedTrainDetail[] = [];
  const detailCache = new Map<string, ParsedTrainDetail>();
  for (const target of detailTargets) {
    let parsed = detailCache.get(target.url);
    if (parsed === undefined) {
      const detailResponse = await collector.collect(
        request(target.url, 'train-detail-html', edition.observedRawEditionKey),
      );
      const detailPage = page(detailResponse, collector.collectorVersion);
      responses.push(detailResponse);
      parsed = detailParser.parse(detailPage.html, detailPage.manifest);
      detailCache.set(target.url, parsed);
    }
    details.push({
      ...parsed,
      candidates: parsed.candidates.map((candidate) => ({
        ...candidate,
        direction: target.source.direction,
        service: target.source.service,
      })),
    });
  }

  const selectedCandidates = selectCandidates(matrixPages, options);
  if (selectedCandidates.length === 0) {
    throw new JrEastPipelineError(
      'AMBIGUOUS_TRIP',
      'No matrix trip matched the requested sample window',
    );
  }
  const detailCandidates = details.flatMap((detail) => detail.candidates);
  const reconciliation = reconcileMatrixWithDetails(
    selectedCandidates,
    detailCandidates,
  );
  const generatedAt = new Date().toISOString();
  const manifests = responses.map((response) =>
    createRawArtifactManifest(response, collector.collectorVersion),
  );
  const dataset = buildDataset({
    candidates: reconciliation.candidates,
    matrixPages,
    details,
    edition,
    manifests,
    generatedAt,
    parserVersion: `${matrixParser.parserVersion}+${detailParser.parserVersion}`,
    line,
  });

  const diagnostics: PipelineDiagnostic[] = [
    ...matrixPages.flatMap((matrixPage) => matrixPage.diagnostics),
    ...reconciliation.conflicts.map((conflict) => ({
      code: 'AMBIGUOUS_TRIP' as const,
      severity: 'warning' as const,
      message: `${conflict.trainNumber}: ${conflict.differences.join('; ')}`,
      sourceUrl: conflict.detailSourceUrl,
    })),
    ...validateNormalizedTimetable(dataset).map((issue) => ({
      code:
        issue.code === 'TIME_REGRESSION'
          ? ('TIME_ORDER_INVALID' as const)
          : ('PARSE_FAILED' as const),
      severity: 'error' as const,
      message: `${issue.path}: ${issue.message}`,
      ...(issue.tripId === undefined ? {} : { tripId: issue.tripId }),
    })),
    ...dataset.stations.map((station) => ({
      code: 'STATION_MAPPING_MISSING' as const,
      severity: 'warning' as const,
      message: `No reviewed OSM mapping was supplied for ${station.nameJa}`,
    })),
  ];
  const validationReport: ValidationReport = {
    status: diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? 'FAIL'
      : 'PASS',
    generatedAt,
    tripCount: dataset.trips.length,
    stationCount: dataset.stations.length,
    diagnostics,
  };
  const runManifest: YamanoteRunManifest = {
    schemaVersion: '1.0',
    datasetVersion: dataset.metadata.datasetVersion,
    operator: OPERATOR_ID,
    line: line.lineKey,
    edition,
    mode: options.mode,
    collectorVersion: collector.collectorVersion,
    parserVersions: [matrixParser.parserVersion, detailParser.parserVersion],
    generatedAt,
    sourceArtifacts: manifests.map((manifest) => ({
      sourceUrl: manifest.sourceUrl,
      sourceType: manifest.sourceType,
      sha256: manifest.sha256,
      requestedAt: manifest.requestedAt,
    })),
  };
  const datasetRoot = await writeYamanoteOutput({
    outputRoot: options.outputRoot,
    dataset,
    responses,
    collectorVersion: collector.collectorVersion,
    runManifest,
    conflicts: reconciliation.conflicts,
    validationReport,
    requestLog: collector.requestLog,
  });
  if (options.mode === 'sample' && validationReport.status === 'PASS') {
    await writeSampleMarker(options.outputRoot, dataset, generatedAt);
  }
  return {
    datasetRoot,
    datasetVersion: dataset.metadata.datasetVersion,
    validationReport,
    conflicts: reconciliation.conflicts,
  };
}

function buildDataset(input: {
  candidates: MatrixTripCandidate[];
  matrixPages: ParsedMatrixPage[];
  details: ParsedTrainDetail[];
  edition: ObservedEdition;
  manifests: RawArtifactManifest[];
  generatedAt: string;
  parserVersion: string;
  line: ReturnType<typeof getJrEastLineDefinition>;
}): NormalizedTimetable {
  const calendarStart = input.details
    .map((detail) => detail.calendarStart)
    .filter((date): date is string => date !== undefined)
    .sort()[0];
  const calendarEnd = input.details
    .map((detail) => detail.calendarEnd)
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
  if (calendarStart === undefined || calendarEnd === undefined) {
    throw new JrEastPipelineError(
      'CALENDAR_UNRESOLVED',
      'Calendar bounds could not be established from detail-page evidence',
    );
  }

  const stationMap = new Map<string, Station>();
  for (const candidate of input.candidates) {
    for (const stop of candidate.stops) {
      const id = createStationId(OPERATOR_ID, stop.stationNameJa);
      if (!stationMap.has(id)) {
        stationMap.set(id, {
          id,
          operatorId: OPERATOR_ID,
          nameJa: stop.stationNameJa,
        });
      }
    }
  }
  const services = [
    ...new Set(input.candidates.map((candidate) => candidate.service)),
  ];
  const calendars = services.map((service) =>
    buildCalendar(
      input.line.lineKey,
      service,
      calendarStart,
      calendarEnd,
      input.matrixPages,
    ),
  );
  const trips = input.candidates.map((candidate) =>
    buildTrip(candidate, input.line.lineKey),
  );
  const metadata = createDatasetMetadata(
    {
      operator: OPERATOR_ID,
      timetableEdition: input.edition.observedRawEditionKey,
      sourceArtifactHashes: input.manifests.map((manifest) => manifest.sha256),
      parserVersion: input.parserVersion,
    },
    input.generatedAt,
  );
  return parseNormalizedTimetable({
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    metadata,
    operators: [
      { id: OPERATOR_ID, nameJa: '東日本旅客鉄道', nameEn: 'JR East' },
    ],
    lines: [
      {
        id: createLineId(OPERATOR_ID, input.line.lineKey),
        operatorId: OPERATOR_ID,
        nameJa: input.line.nameJa,
        nameEn: input.line.nameEn,
      },
    ],
    stations: [...stationMap.values()],
    serviceCalendars: calendars,
    trips,
  });
}

function buildCalendar(
  lineKey: string,
  service: YamanoteService,
  startDate: string,
  endDate: string,
  matrixPages: ParsedMatrixPage[],
): ServiceCalendar {
  const references = matrixPages
    .filter((page) => page.service === service)
    .map((page) => ({
      artifactSha256: page.manifest.sha256,
      sourceUrl: page.manifest.sourceUrl,
      sourceType: page.manifest.sourceType,
      sourceEdition: page.manifest.sourceEdition,
    }));
  const weekday = service === 'weekday';
  return {
    id: `${OPERATOR_ID}:${lineKey}:${service}`,
    startDate,
    endDate,
    monday: weekday,
    tuesday: weekday,
    wednesday: weekday,
    thursday: weekday,
    friday: weekday,
    saturday: !weekday,
    sunday: !weekday,
    exceptions: [],
    calendarConfidence: 'explicit-page-label',
    unresolvedCalendarConditions: [
      'Public-holiday weekday exceptions and temporary suspensions are not inferred in this PoC.',
    ],
    sourceReferences: references,
  };
}

function buildTrip(candidate: MatrixTripCandidate, lineKey: string): Trip {
  const firstEvent = firstTime(candidate);
  const origin = candidate.stops[0]!;
  const destination = candidate.stops.at(-1)!;
  return {
    internalTripId: createTripId({
      operator: OPERATOR_ID,
      edition: candidate.sourceReference.sourceEdition,
      line: lineKey,
      direction: candidate.direction,
      trainNumber: candidate.trainNumber,
      origin: origin.stationNameJa,
      firstDeparture: firstEvent,
      variant: `${candidate.service}-${candidate.columnIndex}`,
    }),
    operator: OPERATOR_ID,
    lineId: createLineId(OPERATOR_ID, lineKey),
    direction: candidate.direction,
    trainNumber: candidate.trainNumber,
    trainType: candidate.trainType,
    originStationId: createStationId(OPERATOR_ID, origin.stationNameJa),
    destinationStationId: createStationId(
      OPERATOR_ID,
      destination.stationNameJa,
    ),
    serviceId: `${OPERATOR_ID}:${lineKey}:${candidate.service}`,
    sourceEdition: candidate.sourceReference.sourceEdition,
    sourceUrl: candidate.sourceReference.sourceUrl,
    sourceReference: candidate.sourceReference,
    operationConditions: [candidate.operationCondition],
    stopTimes: candidate.stops.map((stop, sequence) => ({
      stationId: createStationId(OPERATOR_ID, stop.stationNameJa),
      sequence,
      ...(stop.arrival === undefined ? {} : { arrival: stop.arrival }),
      ...(stop.departure === undefined ? {} : { departure: stop.departure }),
      ...(stop.platform === undefined ? {} : { platform: stop.platform }),
      passThrough: stop.passThrough,
      sourceReference: stop.sourceReference ?? candidate.sourceReference,
    })),
  };
}

function selectCandidates(
  pages: ParsedMatrixPage[],
  options: YamanotePipelineOptions,
): MatrixTripCandidate[] {
  const candidates = pages
    .flatMap((page) => page.candidates)
    .filter((candidate) => {
      const hour =
        Math.floor(serviceDaySeconds(firstTime(candidate)) / 3_600) % 24;
      return hour >= options.hourFrom && hour <= options.hourTo;
    })
    .sort(
      (left, right) =>
        serviceDaySeconds(firstTime(left)) -
        serviceDaySeconds(firstTime(right)),
    );
  return options.maxTrips === undefined
    ? candidates
    : candidates.slice(0, options.maxTrips);
}

function firstTime(candidate: MatrixTripCandidate): ServiceDayTime {
  for (const stop of candidate.stops) {
    const time = stop.departure ?? stop.arrival;
    if (time !== undefined) return time;
  }
  throw new JrEastPipelineError(
    'AMBIGUOUS_TRIP',
    `Train ${candidate.trainNumber} has no observable time`,
    candidate.sourceReference.sourceUrl,
  );
}

function request(sourceUrl: string, sourceType: string, sourceEdition: string) {
  return {
    sourceUrl,
    sourceEdition,
    sourceType,
    operator: 'jr-east' as const,
  };
}

function page(
  response: CollectedResponse,
  collectorVersion: string,
): FetchedPage {
  return {
    response,
    manifest: createRawArtifactManifest(response, collectorVersion),
    html: decode(response.body),
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function validateOptions(options: YamanotePipelineOptions): void {
  if (options.directions.length === 0 || options.services.length === 0) {
    throw new Error('At least one direction and service must be selected');
  }
  if (
    options.hourFrom < 0 ||
    options.hourTo > 23 ||
    options.hourFrom > options.hourTo
  ) {
    throw new Error('Hour range must be within 0..23 and ordered');
  }
  if (options.mode === 'sample' && options.maxTrips === undefined) {
    throw new Error('Sample mode requires a finite --max-trips value');
  }
  if (options.maxDetails < 1) {
    throw new Error(
      'At least one detail page is required for calendar evidence',
    );
  }
}

async function requireSampleMarker(outputRoot: string): Promise<void> {
  const marker = join(outputRoot, '.sample-passed.json');
  try {
    await access(marker);
  } catch (error) {
    throw new JrEastPipelineError(
      'PARSE_FAILED',
      `Full-line mode requires a successful sample marker at ${marker}`,
      undefined,
      { cause: error },
    );
  }
}

async function writeSampleMarker(
  outputRoot: string,
  dataset: NormalizedTimetable,
  generatedAt: string,
): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    join(outputRoot, '.sample-passed.json'),
    `${JSON.stringify(
      {
        datasetVersion: dataset.metadata.datasetVersion,
        generatedAt,
        tripCount: dataset.trips.length,
        validationStatus: 'PASS',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
