import { createDatasetIdentity } from './dataset-version.js';
import { compareServiceDayTimes, isServiceDayTime } from './time.js';
import type {
  NormalizedTimetable,
  ServiceDayTime,
  StationMapping,
  StopTime,
} from './types.js';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  tripId?: string;
}

export function validateNormalizedTimetable(
  dataset: NormalizedTimetable,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const operatorIds = uniqueIds(
    dataset.operators.map((operator) => operator.id),
    'operators',
    issues,
  );
  const lineIds = uniqueIds(
    dataset.lines.map((line) => line.id),
    'lines',
    issues,
  );
  const stationIds = uniqueIds(
    dataset.stations.map((station) => station.id),
    'stations',
    issues,
  );
  const serviceIds = uniqueIds(
    dataset.serviceCalendars.map((calendar) => calendar.id),
    'serviceCalendars',
    issues,
  );

  dataset.lines.forEach((line, index) => {
    if (!operatorIds.has(line.operatorId)) {
      addIssue(
        issues,
        'REFERENCE',
        `lines[${index}].operatorId`,
        `Unknown operator ${line.operatorId}`,
      );
    }
  });
  dataset.stations.forEach((station, index) => {
    if (!operatorIds.has(station.operatorId)) {
      addIssue(
        issues,
        'REFERENCE',
        `stations[${index}].operatorId`,
        `Unknown operator ${station.operatorId}`,
      );
    }
  });

  const seenTripIds = new Map<string, number>();
  dataset.trips.forEach((trip, tripIndex) => {
    const previousIndex = seenTripIds.get(trip.internalTripId);
    if (previousIndex !== undefined) {
      addIssue(
        issues,
        'TRIP_ID_COLLISION',
        `trips[${tripIndex}].internalTripId`,
        `Trip ID also occurs at trips[${previousIndex}]`,
        trip.internalTripId,
      );
    } else {
      seenTripIds.set(trip.internalTripId, tripIndex);
    }

    if (!operatorIds.has(trip.operator)) {
      addTripReferenceIssue(
        issues,
        tripIndex,
        'operator',
        trip.operator,
        trip.internalTripId,
      );
    }
    if (!lineIds.has(trip.lineId)) {
      addTripReferenceIssue(
        issues,
        tripIndex,
        'lineId',
        trip.lineId,
        trip.internalTripId,
      );
    }
    if (!serviceIds.has(trip.serviceId)) {
      addTripReferenceIssue(
        issues,
        tripIndex,
        'serviceId',
        trip.serviceId,
        trip.internalTripId,
      );
    }
    if (!stationIds.has(trip.originStationId)) {
      addTripReferenceIssue(
        issues,
        tripIndex,
        'originStationId',
        trip.originStationId,
        trip.internalTripId,
      );
    }
    if (!stationIds.has(trip.destinationStationId)) {
      addTripReferenceIssue(
        issues,
        tripIndex,
        'destinationStationId',
        trip.destinationStationId,
        trip.internalTripId,
      );
    }
    if (trip.stopTimes.length < 2) {
      addIssue(
        issues,
        'MIN_STOPS',
        `trips[${tripIndex}].stopTimes`,
        'A trip must contain at least two stops',
        trip.internalTripId,
      );
    }
    if (trip.stopTimes[0]?.stationId !== trip.originStationId) {
      addIssue(
        issues,
        'ORIGIN_MISMATCH',
        `trips[${tripIndex}].originStationId`,
        'Origin must match the first stop',
        trip.internalTripId,
      );
    }
    if (trip.stopTimes.at(-1)?.stationId !== trip.destinationStationId) {
      addIssue(
        issues,
        'DESTINATION_MISMATCH',
        `trips[${tripIndex}].destinationStationId`,
        'Destination must match the last stop',
        trip.internalTripId,
      );
    }
    validateStopTimes(
      trip.stopTimes,
      tripIndex,
      trip.internalTripId,
      stationIds,
      issues,
    );
  });

  const expectedIdentity = createDatasetIdentity({
    operator: dataset.metadata.operator,
    timetableEdition: dataset.metadata.timetableEdition,
    sourceArtifactHashes: dataset.metadata.sourceArtifactHashes,
    parserVersion: dataset.metadata.parserVersion,
  });
  if (dataset.metadata.datasetVersion !== expectedIdentity.datasetVersion) {
    addIssue(
      issues,
      'DATASET_VERSION',
      'metadata.datasetVersion',
      'Dataset version does not match its deterministic identity inputs',
    );
  }
  if (dataset.metadata.manifestHash !== expectedIdentity.manifestHash) {
    addIssue(
      issues,
      'MANIFEST_HASH',
      'metadata.manifestHash',
      'Manifest hash does not match its deterministic identity inputs',
    );
  }

  return issues;
}

export function validateStationMapping(
  mapping: StationMapping,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasLatitude = mapping.latitude !== undefined;
  const hasLongitude = mapping.longitude !== undefined;
  const hasOsmType = mapping.osmElementType !== undefined;
  const hasOsmId = mapping.osmElementId !== undefined;

  if (hasLatitude !== hasLongitude) {
    addIssue(
      issues,
      'COORDINATE_PAIR',
      'latitude',
      'Latitude and longitude must be provided together',
    );
  }
  if (
    mapping.latitude !== undefined &&
    (mapping.latitude < -90 || mapping.latitude > 90)
  ) {
    addIssue(
      issues,
      'LATITUDE_RANGE',
      'latitude',
      'Latitude must be between -90 and 90',
    );
  }
  if (
    mapping.longitude !== undefined &&
    (mapping.longitude < -180 || mapping.longitude > 180)
  ) {
    addIssue(
      issues,
      'LONGITUDE_RANGE',
      'longitude',
      'Longitude must be between -180 and 180',
    );
  }
  if (hasOsmType !== hasOsmId) {
    addIssue(
      issues,
      'OSM_ELEMENT_PAIR',
      'osmElementType',
      'OSM element type and ID must be provided together',
    );
  }
  if (
    mapping.osmElementId !== undefined &&
    (!Number.isSafeInteger(mapping.osmElementId) || mapping.osmElementId <= 0)
  ) {
    addIssue(
      issues,
      'OSM_ELEMENT_ID',
      'osmElementId',
      'OSM element ID must be a positive integer',
    );
  }
  if (
    mapping.mappingStatus === 'confirmed' &&
    mapping.reviewedAt === undefined
  ) {
    addIssue(
      issues,
      'MANUAL_REVIEW_REQUIRED',
      'reviewedAt',
      'A confirmed mapping requires an explicit review timestamp',
    );
  }
  if (mapping.reviewedAt !== undefined && !isIsoTimestamp(mapping.reviewedAt)) {
    addIssue(
      issues,
      'TIMESTAMP',
      'reviewedAt',
      'reviewedAt must be an ISO-8601 timestamp',
    );
  }
  return issues;
}

function validateStopTimes(
  stopTimes: StopTime[],
  tripIndex: number,
  tripId: string,
  stationIds: Set<string>,
  issues: ValidationIssue[],
): void {
  const sequences = new Set<number>();
  let previousSequence = -1;
  let previousEvent: ServiceDayTime | undefined;

  stopTimes.forEach((stop, stopIndex) => {
    const path = `trips[${tripIndex}].stopTimes[${stopIndex}]`;
    if (!stationIds.has(stop.stationId)) {
      addIssue(
        issues,
        'REFERENCE',
        `${path}.stationId`,
        `Unknown station ${stop.stationId}`,
        tripId,
      );
    }
    if (sequences.has(stop.sequence)) {
      addIssue(
        issues,
        'DUPLICATE_SEQUENCE',
        `${path}.sequence`,
        'Stop sequence is duplicated',
        tripId,
      );
    }
    sequences.add(stop.sequence);
    if (
      !Number.isInteger(stop.sequence) ||
      stop.sequence < 0 ||
      stop.sequence <= previousSequence
    ) {
      addIssue(
        issues,
        'SEQUENCE_ORDER',
        `${path}.sequence`,
        'Stop sequence must be a non-negative, strictly increasing integer',
        tripId,
      );
    }
    previousSequence = stop.sequence;

    const arrival = validTimeOrIssue(
      stop.arrival,
      `${path}.arrival`,
      tripId,
      issues,
    );
    const departure = validTimeOrIssue(
      stop.departure,
      `${path}.departure`,
      tripId,
      issues,
    );
    if (!stop.passThrough && arrival === undefined && departure === undefined) {
      addIssue(
        issues,
        'MISSING_STOP_TIME',
        path,
        'A non-pass-through stop requires an arrival or departure time',
        tripId,
      );
    }
    if (
      arrival !== undefined &&
      previousEvent !== undefined &&
      compareServiceDayTimes(arrival, previousEvent) < 0
    ) {
      addIssue(
        issues,
        'TIME_REGRESSION',
        `${path}.arrival`,
        'Arrival is earlier than the prior event',
        tripId,
      );
    }
    if (departure !== undefined) {
      const lowerBound = arrival ?? previousEvent;
      if (
        lowerBound !== undefined &&
        compareServiceDayTimes(departure, lowerBound) < 0
      ) {
        addIssue(
          issues,
          'TIME_REGRESSION',
          `${path}.departure`,
          'Departure is earlier than arrival or the prior event',
          tripId,
        );
      }
    }
    previousEvent = departure ?? arrival ?? previousEvent;
  });
}

function validTimeOrIssue(
  value: ServiceDayTime | undefined,
  path: string,
  tripId: string,
  issues: ValidationIssue[],
): ServiceDayTime | undefined {
  if (value === undefined) return undefined;
  if (!isServiceDayTime(value)) {
    addIssue(
      issues,
      'TIME_FORMAT',
      path,
      'Invalid service-day time object',
      tripId,
    );
    return undefined;
  }
  return value;
}

function uniqueIds(
  ids: string[],
  path: string,
  issues: ValidationIssue[],
): Set<string> {
  const result = new Set<string>();
  ids.forEach((id, index) => {
    if (result.has(id)) {
      addIssue(
        issues,
        'DUPLICATE_ID',
        `${path}[${index}].id`,
        `Duplicate ID ${id}`,
      );
    }
    result.add(id);
  });
  return result;
}

function addTripReferenceIssue(
  issues: ValidationIssue[],
  tripIndex: number,
  field: string,
  value: string,
  tripId: string,
): void {
  addIssue(
    issues,
    'REFERENCE',
    `trips[${tripIndex}].${field}`,
    `Unknown reference ${value}`,
    tripId,
  );
}

function addIssue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
  tripId?: string,
): void {
  issues.push({
    code,
    path,
    message,
    ...(tripId === undefined ? {} : { tripId }),
  });
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
}
