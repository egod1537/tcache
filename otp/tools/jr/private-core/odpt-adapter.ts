import {
  createDatasetMetadata,
  createLineId,
  createStationId,
  createTripId,
  hashCanonicalJson,
  parseNormalizedTimetable,
  parseServiceDayTime,
  serviceDaySeconds,
  type Line,
  type NormalizedTimetable,
  type ServiceCalendar,
  type ServiceDayTime,
  type Station,
  type StationMappingSet,
  type StopTime,
  type Trip,
} from '../common/index.js';
import {
  PRIVATE_CORE_ADAPTER_VERSION,
  type OdptAdapterInput,
  type OdptAdapterResult,
  type PrivateLineConfig,
} from './model.js';

type JsonRecord = Record<string, unknown>;

interface RailwayContext {
  sourceId: string;
  line: Line;
  config: PrivateLineConfig;
  stationIndexes: Map<string, number>;
}

interface Observation {
  stationSourceId: string;
  stationId: string;
  stationIndex: number;
  rawArrival?: string;
  rawDeparture?: string;
  platform?: string;
  sourceObject: JsonRecord;
}

interface TripCandidate {
  key: string;
  railway: RailwayContext;
  calendarSourceId: string;
  directionSourceId: string;
  trainNumber: string;
  trainTypeSourceId: string;
  observations: Observation[];
}

export function adaptOdptStationTimetables(
  input: OdptAdapterInput,
): OdptAdapterResult {
  validateInput(input);
  const railwayRows = records(input.railways, 'railways');
  const stationRows = records(input.stations, 'stations');
  const timetableRows = records(input.stationTimetables, 'stationTimetables');
  const lineConfigs = new Map(
    input.operator.lines.map((line) => [line.sourceKey, line]),
  );
  const railwayContexts = new Map<string, RailwayContext>();
  const ignoredRailways: string[] = [];

  for (const railway of railwayRows) {
    const sourceId = requiredString(railway, 'owl:sameAs');
    const sourceKey = lastSegment(sourceId);
    const config = lineConfigs.get(sourceKey);
    if (!config) {
      ignoredRailways.push(sourceId);
      continue;
    }
    const stationIndexes = new Map<string, number>();
    for (const order of optionalRecords(railway['odpt:stationOrder'])) {
      const stationSourceId = optionalString(order, 'odpt:station');
      const index = optionalNumber(order, 'odpt:index');
      if (stationSourceId && index !== undefined) {
        stationIndexes.set(stationSourceId, index);
      }
    }
    if (stationIndexes.size < 2) {
      throw new Error(`${sourceId} has fewer than two ordered stations`);
    }
    railwayContexts.set(sourceId, {
      sourceId,
      config,
      line: {
        id: createLineId(input.operator.operatorId, config.sourceKey),
        operatorId: input.operator.operatorId,
        nameJa: config.nameJa,
        ...(config.nameEn ? { nameEn: config.nameEn } : {}),
      },
      stationIndexes,
    });
  }
  if (railwayContexts.size === 0) {
    throw new Error('No configured railway was present in the ODPT response');
  }
  const presentLineKeys = new Set(
    [...railwayContexts.values()].map((context) => context.config.sourceKey),
  );
  const missingLineKeys = input.operator.lines
    .map((line) => line.sourceKey)
    .filter((sourceKey) => !presentLineKeys.has(sourceKey));
  if (missingLineKeys.length > 0) {
    throw new Error(
      `Configured ODPT railways are missing: ${missingLineKeys.join(', ')}`,
    );
  }

  const stationSourceRows = new Map<string, JsonRecord>();
  const normalizedStations = new Map<string, Station>();
  for (const station of stationRows) {
    const sourceId = requiredString(station, 'owl:sameAs');
    const railwaySourceId = requiredString(station, 'odpt:railway');
    if (!railwayContexts.has(railwaySourceId)) continue;
    const stationId = stationIdFor(input.operator.operatorId, sourceId);
    stationSourceRows.set(sourceId, station);
    const nameEn = englishTitle(station['odpt:stationTitle']);
    const stationNumber = optionalString(station, 'odpt:stationCode');
    normalizedStations.set(stationId, {
      id: stationId,
      operatorId: input.operator.operatorId,
      nameJa: localizedTitle(station['odpt:stationTitle'], station['dc:title']),
      ...(nameEn ? { nameEn } : {}),
      ...(stationNumber ? { stationNumber } : {}),
    });
  }

  const candidates = new Map<string, TripCandidate>();
  let ignoredTimetables = 0;
  for (const timetable of timetableRows) {
    const railwaySourceId = requiredString(timetable, 'odpt:railway');
    const railway = railwayContexts.get(railwaySourceId);
    if (!railway) {
      ignoredTimetables += 1;
      continue;
    }
    const stationSourceId = requiredString(timetable, 'odpt:station');
    const stationIndex = railway.stationIndexes.get(stationSourceId);
    const stationId = stationIdFor(input.operator.operatorId, stationSourceId);
    if (stationIndex === undefined || !normalizedStations.has(stationId)) {
      throw new Error(
        `${stationSourceId} is missing from the selected railway/station responses`,
      );
    }
    const calendar = requiredString(timetable, 'odpt:calendar');
    const direction = requiredString(timetable, 'odpt:railDirection');
    const objects = optionalRecords(timetable['odpt:stationTimetableObject']);
    for (const object of objects) {
      const rawArrival = optionalString(object, 'odpt:arrivalTime');
      const rawDeparture = optionalString(object, 'odpt:departureTime');
      if (!rawArrival && !rawDeparture) continue;
      const trainNumber =
        optionalString(object, 'odpt:trainNumber') ??
        optionalString(timetable, 'odpt:trainNumber');
      if (!trainNumber) continue;
      const trainIdentity = optionalString(object, 'odpt:train');
      const destination = stringList(object['odpt:destinationStation']).join(
        ',',
      );
      const origin = stringList(object['odpt:originStation']).join(',');
      const key =
        trainIdentity ??
        [
          railwaySourceId,
          calendar,
          direction,
          trainNumber,
          origin,
          destination,
        ].join('|');
      const candidate = candidates.get(key) ?? {
        key,
        railway,
        calendarSourceId: calendar,
        directionSourceId: direction,
        trainNumber,
        trainTypeSourceId:
          optionalString(object, 'odpt:trainType') ?? 'odpt.TrainType:Unknown',
        observations: [],
      };
      const platform = optionalString(object, 'odpt:platformNumber');
      candidate.observations.push({
        stationSourceId,
        stationId,
        stationIndex,
        ...(rawArrival ? { rawArrival } : {}),
        ...(rawDeparture ? { rawDeparture } : {}),
        ...(platform ? { platform } : {}),
        sourceObject: object,
      });
      candidates.set(key, candidate);
    }
  }

  const calendarIds = new Set<string>();
  const trips: Trip[] = [];
  const skippedTripCandidates: Array<{ key: string; reason: string }> = [];
  const timetableHash = input.sourceArtifactHashes.at(-1)!;
  for (const candidate of [...candidates.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    const ordered = orderAndNormalize(candidate.observations);
    if (!ordered || ordered.length < 2) {
      skippedTripCandidates.push({
        key: candidate.key,
        reason: 'AMBIGUOUS_OR_FEWER_THAN_TWO_STOPS',
      });
      continue;
    }
    const serviceId = calendarId(
      input.operator.operatorId,
      candidate.calendarSourceId,
    );
    calendarIds.add(serviceId);
    const first = ordered[0]!;
    const last = ordered.at(-1)!;
    const firstIndex = candidate.observations.find(
      (observation) => observation.stationId === first.stationId,
    )!.stationIndex;
    const lastIndex = candidate.observations.find(
      (observation) => observation.stationId === last.stationId,
    )!.stationIndex;
    const direction = firstIndex < lastIndex ? 'ascending' : 'descending';
    const firstDeparture = first.departure ?? first.arrival!;
    const variant = hashCanonicalJson({
      sourceTrip: candidate.key,
      stops: ordered.map((stop) => stop.stationId),
    }).slice(0, 10);
    const sourceReference = {
      artifactSha256: timetableHash,
      sourceUrl: input.sourceUrls.stationTimetables,
      sourceType: 'odpt:StationTimetable',
      sourceEdition: input.sourceEdition,
      sourceUrlKey: candidate.key,
    };
    trips.push({
      internalTripId: createTripId({
        operator: input.operator.operatorId,
        edition: input.sourceEdition,
        line: candidate.railway.config.sourceKey,
        direction,
        trainNumber: candidate.trainNumber,
        origin: first.stationId,
        firstDeparture,
        variant,
      }),
      operator: input.operator.operatorId,
      lineId: candidate.railway.line.id,
      direction,
      trainNumber: candidate.trainNumber,
      trainType: lastSegment(candidate.trainTypeSourceId),
      originStationId: first.stationId,
      destinationStationId: ordered.at(-1)!.stationId,
      serviceId,
      sourceEdition: input.sourceEdition,
      sourceUrl: input.sourceUrls.stationTimetables,
      sourceReference,
      operationConditions: [
        `Source rail direction: ${candidate.directionSourceId}`,
        'No cross-line through-service merge was inferred by the adapter.',
      ],
      stopTimes: ordered.map((stop, index) => {
        const sourceStationKey = candidate.observations.find(
          (observation) => observation.stationId === stop.stationId,
        )!.stationSourceId;
        return {
          ...stop,
          sequence: index + 1,
          passThrough: false,
          sourceReference: { ...sourceReference, sourceStationKey },
        };
      }),
    });
  }
  if (trips.length === 0) {
    throw new Error(
      'No valid trip with two or more stops could be reconstructed',
    );
  }

  const serviceCalendars = [...calendarIds]
    .sort()
    .map((id) =>
      buildCalendar(id, input.serviceStartDate, input.serviceEndDate),
    );
  const metadata = createDatasetMetadata(
    {
      operator: input.operator.operatorId,
      timetableEdition: input.sourceEdition,
      sourceArtifactHashes: input.sourceArtifactHashes,
      parserVersion: PRIVATE_CORE_ADAPTER_VERSION,
    },
    input.generatedAt,
  );
  const dataset: NormalizedTimetable = parseNormalizedTimetable({
    schemaVersion: '1.0',
    metadata,
    operators: [
      {
        id: input.operator.operatorId,
        nameJa: input.operator.nameJa,
        nameEn: input.operator.nameEn,
      },
    ],
    lines: [...railwayContexts.values()].map((context) => context.line),
    stations: [...normalizedStations.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    serviceCalendars,
    trips,
  });

  const mappingCandidates: StationMappingSet = {
    schemaVersion: '1.0',
    operator: input.operator.operatorId,
    reviewMethod:
      'Official ODPT coordinates are candidates only; OSM station/entrance review is required before GTFS generation.',
    source: {
      name: `${input.operator.nameEn} ODPT station API`,
      url: input.sourceUrls.stations,
      license: 'Public Transport Open Data Challenge Limited License',
      attribution: input.operator.nameJa,
      retrievedAt: input.generatedAt,
    },
    mappings: dataset.stations.map((station) => {
      const sourceEntry = [...stationSourceRows.entries()].find(
        ([sourceId]) =>
          stationIdFor(input.operator.operatorId, sourceId) === station.id,
      );
      const row = sourceEntry?.[1];
      const latitude = row ? optionalNumber(row, 'geo:lat') : undefined;
      const longitude = row ? optionalNumber(row, 'geo:long') : undefined;
      return {
        internalStationId: station.id,
        operator: input.operator.operatorId,
        officialNameJa: station.nameJa,
        ...(station.nameEn ? { officialNameEn: station.nameEn } : {}),
        ...(sourceEntry ? { sourceStationKey: sourceEntry[0] } : {}),
        ...(station.stationNumber
          ? { stationNumber: station.stationNumber }
          : {}),
        ...(latitude !== undefined ? { latitude } : {}),
        ...(longitude !== undefined ? { longitude } : {}),
        mappingStatus: 'candidate' as const,
      };
    }),
  };

  return {
    dataset,
    mappingCandidates,
    diagnostics: {
      ignoredRailways: ignoredRailways.sort(),
      ignoredTimetables,
      skippedTripCandidates,
      throughServiceMerges: 0,
    },
  };
}

function orderAndNormalize(
  observations: Observation[],
): StopTime[] | undefined {
  const unique = new Map<number, Observation>();
  for (const observation of observations) {
    if (unique.has(observation.stationIndex)) return undefined;
    unique.set(observation.stationIndex, observation);
  }
  const ascending = [...unique.values()].sort(
    (a, b) => a.stationIndex - b.stationIndex,
  );
  const descending = [...ascending].reverse();
  const candidates = [normalizeOrdered(ascending), normalizeOrdered(descending)]
    .filter(
      (value): value is { stops: StopTime[]; duration: number } => !!value,
    )
    .sort((a, b) => a.duration - b.duration);
  if (candidates.length === 0) return undefined;
  if (
    candidates.length > 1 &&
    candidates[0]!.duration === candidates[1]!.duration
  ) {
    return undefined;
  }
  return candidates[0]!.stops;
}

function normalizeOrdered(
  ordered: Observation[],
): { stops: StopTime[]; duration: number } | undefined {
  let previousSeconds: number | undefined;
  let dayOffset = 0;
  const stops: StopTime[] = [];
  for (const observation of ordered) {
    const rawPrimary = observation.rawDeparture ?? observation.rawArrival;
    if (!rawPrimary) return undefined;
    const primary = parseServiceDayTime(rawPrimary);
    let seconds = serviceDaySeconds(primary) + dayOffset * 86_400;
    if (previousSeconds !== undefined && seconds < previousSeconds) {
      const previousHour = Math.floor((previousSeconds % 86_400) / 3600);
      if (previousHour < 18 || primary.hour > 6) return undefined;
      dayOffset += 1;
      seconds += 86_400;
    }
    if (previousSeconds !== undefined && seconds < previousSeconds)
      return undefined;
    const arrival = observation.rawArrival
      ? withDayOffset(parseServiceDayTime(observation.rawArrival), dayOffset)
      : undefined;
    const departure = observation.rawDeparture
      ? withDayOffset(parseServiceDayTime(observation.rawDeparture), dayOffset)
      : undefined;
    if (
      arrival &&
      departure &&
      serviceDaySeconds(departure) < serviceDaySeconds(arrival)
    ) {
      return undefined;
    }
    stops.push({
      stationId: observation.stationId,
      sequence: stops.length + 1,
      ...(arrival ? { arrival } : {}),
      ...(departure ? { departure } : {}),
      ...(observation.platform ? { platform: observation.platform } : {}),
      passThrough: false,
    });
    previousSeconds = Math.max(
      arrival ? serviceDaySeconds(arrival) : 0,
      departure ? serviceDaySeconds(departure) : 0,
    );
  }
  const first = stops[0]?.departure ?? stops[0]?.arrival;
  const last = stops.at(-1)?.arrival ?? stops.at(-1)?.departure;
  if (!first || !last) return undefined;
  return {
    stops,
    duration: serviceDaySeconds(last) - serviceDaySeconds(first),
  };
}

function buildCalendar(
  id: string,
  startDate: string,
  endDate: string,
): ServiceCalendar {
  const sourceKey = id.split(':').at(-1)!.toLowerCase();
  const weekday = /weekday/.test(sourceKey);
  const saturdayHoliday = /saturdayholiday|saturdayandholiday|holiday/.test(
    sourceKey,
  );
  const saturdayOnly = sourceKey === 'saturday';
  if (!weekday && !saturdayHoliday && !saturdayOnly) {
    return {
      id,
      startDate,
      endDate,
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      exceptions: [],
      calendarConfidence: 'unresolved',
      unresolvedCalendarConditions: [
        `Unsupported ODPT calendar identifier: ${sourceKey}`,
      ],
    };
  }
  return {
    id,
    startDate,
    endDate,
    monday: weekday,
    tuesday: weekday,
    wednesday: weekday,
    thursday: weekday,
    friday: weekday,
    saturday: saturdayHoliday || saturdayOnly,
    sunday: saturdayHoliday,
    exceptions: [],
    calendarConfidence: 'detail-calendar',
  };
}

function validateInput(input: OdptAdapterInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceStartDate)) {
    throw new Error('serviceStartDate must be YYYY-MM-DD');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceEndDate)) {
    throw new Error('serviceEndDate must be YYYY-MM-DD');
  }
  if (input.serviceEndDate < input.serviceStartDate) {
    throw new Error('serviceEndDate must not precede serviceStartDate');
  }
  if (input.sourceArtifactHashes.length !== 3) {
    throw new Error('Exactly three source artifact hashes are required');
  }
  for (const hash of input.sourceArtifactHashes) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid source SHA-256');
  }
}

function stationIdFor(operatorId: string, sourceId: string): string {
  const parts = sourceId.split(':').at(-1)!.split('.');
  const stableKey = parts.slice(-2).join('-');
  return createStationId(operatorId, stableKey);
}

function calendarId(operatorId: string, sourceId: string): string {
  return `${operatorId}:${lastSegment(sourceId).toLowerCase()}`;
}

function lastSegment(value: string): string {
  return value.split(/[:.]/).at(-1) ?? value;
}

function localizedTitle(value: unknown, fallback: unknown): string {
  if (isRecord(value)) {
    const ja = value.ja;
    if (typeof ja === 'string' && ja.length > 0) return ja;
  }
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  throw new Error('Station title is missing');
}

function englishTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.en === 'string' && value.en.length > 0
    ? value.en
    : undefined;
}

function withDayOffset(
  value: ServiceDayTime,
  dayOffset: number,
): ServiceDayTime {
  return { ...value, dayOffset: value.dayOffset + dayOffset };
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`${label} must be an array of objects`);
  }
  return value;
}

function optionalRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function requiredString(record: JsonRecord, key: string): string {
  const value = optionalString(record, key);
  if (!value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
