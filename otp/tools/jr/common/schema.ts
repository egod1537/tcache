import { isServiceDayTime } from './time.js';
import {
  NORMALIZED_SCHEMA_VERSION,
  RAW_ARTIFACT_SCHEMA_VERSION,
  type NormalizedTimetable,
  type RawArtifactManifest,
  type StationMapping,
  type StationMappingSet,
} from './types.js';
import {
  validateNormalizedTimetable,
  validateStationMapping,
} from './validation.js';

export class SchemaParseError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Schema validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'SchemaParseError';
  }
}

export function parseNormalizedTimetable(input: unknown): NormalizedTimetable {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SchemaParseError(['root must be an object']);

  requiredLiteral(
    input,
    'schemaVersion',
    NORMALIZED_SCHEMA_VERSION,
    'root',
    issues,
  );
  validateMetadata(input.metadata, issues);
  validateOperators(input.operators, issues);
  validateLines(input.lines, issues);
  validateStations(input.stations, issues);
  validateCalendars(input.serviceCalendars, issues);
  validateTrips(input.trips, issues);
  if (issues.length > 0) throw new SchemaParseError(issues);

  const dataset = input as unknown as NormalizedTimetable;
  const semanticIssues = validateNormalizedTimetable(dataset).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
  if (semanticIssues.length > 0) throw new SchemaParseError(semanticIssues);
  return dataset;
}

export function parseRawArtifactManifest(input: unknown): RawArtifactManifest {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SchemaParseError(['root must be an object']);
  requiredLiteral(
    input,
    'schemaVersion',
    RAW_ARTIFACT_SCHEMA_VERSION,
    'root',
    issues,
  );
  for (const field of [
    'sourceUrl',
    'requestedAt',
    'contentType',
    'sha256',
    'sourceEdition',
    'sourceType',
    'operator',
    'collectorVersion',
  ]) {
    requiredString(input, field, 'root', issues);
  }
  requiredInteger(input, 'httpStatus', 'root', issues, 100, 599);
  requiredInteger(input, 'byteLength', 'root', issues, 0);
  if (
    typeof input.sha256 === 'string' &&
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    issues.push('root.sha256 must be a lowercase SHA-256 hex digest');
  }
  if (typeof input.sourceUrl === 'string' && !isHttpUrl(input.sourceUrl)) {
    issues.push('root.sourceUrl must be an HTTP(S) URL');
  }
  if (
    typeof input.requestedAt === 'string' &&
    !isIsoTimestamp(input.requestedAt)
  ) {
    issues.push('root.requestedAt must be an ISO-8601 timestamp');
  }
  if (issues.length > 0) throw new SchemaParseError(issues);
  return input as unknown as RawArtifactManifest;
}

export function parseStationMapping(input: unknown): StationMapping {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SchemaParseError(['root must be an object']);
  for (const field of [
    'internalStationId',
    'operator',
    'officialNameJa',
    'mappingStatus',
  ]) {
    requiredString(input, field, 'root', issues);
  }
  optionalStringFields(
    input,
    ['officialNameEn', 'sourceStationKey', 'stationNumber', 'reviewedAt'],
    'root',
    issues,
  );
  optionalNumberFields(
    input,
    ['osmElementId', 'latitude', 'longitude'],
    'root',
    issues,
  );
  if (
    input.mappingStatus !== undefined &&
    !['unmapped', 'candidate', 'confirmed', 'rejected'].includes(
      String(input.mappingStatus),
    )
  ) {
    issues.push('root.mappingStatus is invalid');
  }
  if (
    input.osmElementType !== undefined &&
    !['node', 'way', 'relation'].includes(String(input.osmElementType))
  ) {
    issues.push('root.osmElementType is invalid');
  }
  if (issues.length > 0) throw new SchemaParseError(issues);
  const mapping = input as unknown as StationMapping;
  const semanticIssues = validateStationMapping(mapping).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
  if (semanticIssues.length > 0) throw new SchemaParseError(semanticIssues);
  return mapping;
}

export function parseStationMappingSet(input: unknown): StationMappingSet {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SchemaParseError(['root must be an object']);
  requiredLiteral(input, 'schemaVersion', '1.0', 'root', issues);
  requiredString(input, 'operator', 'root', issues);
  requiredString(input, 'reviewMethod', 'root', issues);
  optionalStringFields(input, ['lineId'], 'root', issues);
  if (!isRecord(input.source)) {
    issues.push('root.source must be an object');
  } else {
    for (const field of ['name', 'url', 'retrievedAt']) {
      requiredString(input.source, field, 'root.source', issues);
    }
    optionalStringFields(
      input.source,
      ['license', 'attribution'],
      'root.source',
      issues,
    );
    if (typeof input.source.url === 'string' && !isHttpUrl(input.source.url)) {
      issues.push('root.source.url must be an HTTP(S) URL');
    }
    if (
      typeof input.source.retrievedAt === 'string' &&
      !isIsoTimestamp(input.source.retrievedAt)
    ) {
      issues.push('root.source.retrievedAt must be an ISO-8601 timestamp');
    }
    if (input.source.routeRelationIds !== undefined) {
      if (!Array.isArray(input.source.routeRelationIds)) {
        issues.push('root.source.routeRelationIds must be an array');
      } else {
        input.source.routeRelationIds.forEach((id, index) => {
          if (!Number.isSafeInteger(id) || Number(id) <= 0) {
            issues.push(
              `root.source.routeRelationIds[${index}] must be a positive integer`,
            );
          }
        });
      }
    }
  }
  if (!Array.isArray(input.mappings) || input.mappings.length === 0) {
    issues.push('root.mappings must be a non-empty array');
  } else {
    input.mappings.forEach((mapping, index) => {
      try {
        const parsed = parseStationMapping(mapping);
        if (
          typeof input.operator === 'string' &&
          parsed.operator !== input.operator
        ) {
          issues.push(
            `root.mappings[${index}].operator must match root.operator`,
          );
        }
      } catch (error) {
        if (error instanceof SchemaParseError) {
          issues.push(
            ...error.issues.map(
              (issue) =>
                `root.mappings[${index}].${issue.replace(/^root\./, '')}`,
            ),
          );
        } else {
          throw error;
        }
      }
    });
  }
  if (issues.length > 0) throw new SchemaParseError(issues);
  return input as unknown as StationMappingSet;
}

function validateMetadata(value: unknown, issues: string[]): void {
  if (!recordAt(value, 'metadata', issues)) return;
  for (const field of [
    'operator',
    'timetableEdition',
    'parserVersion',
    'datasetVersion',
    'manifestHash',
    'generatedAt',
  ]) {
    requiredString(value, field, 'metadata', issues);
  }
  stringArray(
    value.sourceArtifactHashes,
    'metadata.sourceArtifactHashes',
    issues,
  );
  if (Array.isArray(value.sourceArtifactHashes)) {
    if (value.sourceArtifactHashes.length === 0) {
      issues.push('metadata.sourceArtifactHashes must not be empty');
    }
    value.sourceArtifactHashes.forEach((hash, index) => {
      if (typeof hash === 'string' && !/^[a-f0-9]{64}$/.test(hash)) {
        issues.push(
          `metadata.sourceArtifactHashes[${index}] must be a SHA-256 digest`,
        );
      }
    });
  }
  if (
    typeof value.manifestHash === 'string' &&
    !/^[a-f0-9]{64}$/.test(value.manifestHash)
  ) {
    issues.push('metadata.manifestHash must be a SHA-256 digest');
  }
  if (
    typeof value.generatedAt === 'string' &&
    !isIsoTimestamp(value.generatedAt)
  ) {
    issues.push('metadata.generatedAt must be an ISO-8601 timestamp');
  }
}

function validateOperators(value: unknown, issues: string[]): void {
  arrayOfRecords(value, 'operators', issues, (item, path) => {
    requiredString(item, 'id', path, issues);
    requiredString(item, 'nameJa', path, issues);
    optionalStringFields(item, ['nameEn'], path, issues);
  });
}

function validateLines(value: unknown, issues: string[]): void {
  arrayOfRecords(value, 'lines', issues, (item, path) => {
    for (const field of ['id', 'operatorId', 'nameJa'])
      requiredString(item, field, path, issues);
    optionalStringFields(item, ['nameEn'], path, issues);
  });
}

function validateStations(value: unknown, issues: string[]): void {
  arrayOfRecords(value, 'stations', issues, (item, path) => {
    for (const field of ['id', 'operatorId', 'nameJa'])
      requiredString(item, field, path, issues);
    optionalStringFields(item, ['nameEn', 'stationNumber'], path, issues);
  });
}

function validateCalendars(value: unknown, issues: string[]): void {
  arrayOfRecords(value, 'serviceCalendars', issues, (item, path) => {
    for (const field of ['id', 'startDate', 'endDate'])
      requiredString(item, field, path, issues);
    for (const field of [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]) {
      requiredBoolean(item, field, path, issues);
    }
    arrayOfRecords(
      item.exceptions,
      `${path}.exceptions`,
      issues,
      (exception, exceptionPath) => {
        requiredString(exception, 'date', exceptionPath, issues);
        requiredBoolean(exception, 'serviceAdded', exceptionPath, issues);
      },
    );
    if (item.calendarConfidence !== undefined) {
      if (
        !['explicit-page-label', 'detail-calendar', 'unresolved'].includes(
          String(item.calendarConfidence),
        )
      ) {
        issues.push(`${path}.calendarConfidence is invalid`);
      }
    }
    if (item.unresolvedCalendarConditions !== undefined) {
      stringArray(
        item.unresolvedCalendarConditions,
        `${path}.unresolvedCalendarConditions`,
        issues,
      );
    }
    if (item.sourceReferences !== undefined) {
      arrayOfRecords(
        item.sourceReferences,
        `${path}.sourceReferences`,
        issues,
        (reference, referencePath) =>
          validateSourceReference(reference, referencePath, issues),
      );
    }
  });
}

function validateTrips(value: unknown, issues: string[]): void {
  arrayOfRecords(value, 'trips', issues, (item, path) => {
    for (const field of [
      'internalTripId',
      'operator',
      'lineId',
      'direction',
      'trainNumber',
      'trainType',
      'originStationId',
      'destinationStationId',
      'serviceId',
      'sourceEdition',
      'sourceUrl',
    ]) {
      requiredString(item, field, path, issues);
    }
    if (typeof item.sourceUrl === 'string' && !isHttpUrl(item.sourceUrl)) {
      issues.push(`${path}.sourceUrl must be an HTTP(S) URL`);
    }
    validateSourceReference(
      item.sourceReference,
      `${path}.sourceReference`,
      issues,
    );
    if (item.operationConditions !== undefined) {
      stringArray(
        item.operationConditions,
        `${path}.operationConditions`,
        issues,
      );
    }
    arrayOfRecords(
      item.stopTimes,
      `${path}.stopTimes`,
      issues,
      (stop, stopPath) => {
        requiredString(stop, 'stationId', stopPath, issues);
        requiredInteger(stop, 'sequence', stopPath, issues, 0);
        requiredBoolean(stop, 'passThrough', stopPath, issues);
        optionalStringFields(stop, ['platform'], stopPath, issues);
        for (const field of ['arrival', 'departure']) {
          if (stop[field] !== undefined && !isServiceDayTime(stop[field])) {
            issues.push(
              `${stopPath}.${field} must be a valid service-day time object`,
            );
          }
        }
        if (stop.sourceReference !== undefined) {
          validateSourceReference(
            stop.sourceReference,
            `${stopPath}.sourceReference`,
            issues,
          );
        }
      },
    );
  });
}

function validateSourceReference(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (!recordAt(value, path, issues)) return;
  for (const field of [
    'artifactSha256',
    'sourceUrl',
    'sourceType',
    'sourceEdition',
  ]) {
    requiredString(value, field, path, issues);
  }
  optionalStringFields(
    value,
    ['sourceUrlKey', 'sourceStationKey'],
    path,
    issues,
  );
  if (
    typeof value.artifactSha256 === 'string' &&
    !/^[a-f0-9]{64}$/.test(value.artifactSha256)
  ) {
    issues.push(`${path}.artifactSha256 must be a SHA-256 digest`);
  }
  if (typeof value.sourceUrl === 'string' && !isHttpUrl(value.sourceUrl)) {
    issues.push(`${path}.sourceUrl must be an HTTP(S) URL`);
  }
}

function arrayOfRecords(
  value: unknown,
  path: string,
  issues: string[],
  validate: (item: Record<string, unknown>, path: string) => void,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (recordAt(item, itemPath, issues)) validate(item, itemPath);
  });
}

function stringArray(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    issues.push(`${path} must be an array of non-empty strings`);
  }
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: string[],
): void {
  if (
    typeof record[field] !== 'string' ||
    (record[field] as string).trim().length === 0
  ) {
    issues.push(`${path}.${field} must be a non-empty string`);
  }
}

function optionalStringFields(
  record: Record<string, unknown>,
  fields: string[],
  path: string,
  issues: string[],
): void {
  for (const field of fields) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      issues.push(`${path}.${field} must be a string when present`);
    }
  }
}

function optionalNumberFields(
  record: Record<string, unknown>,
  fields: string[],
  path: string,
  issues: string[],
): void {
  for (const field of fields) {
    if (
      record[field] !== undefined &&
      (typeof record[field] !== 'number' || !Number.isFinite(record[field]))
    ) {
      issues.push(`${path}.${field} must be a finite number when present`);
    }
  }
}

function requiredBoolean(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: string[],
): void {
  if (typeof record[field] !== 'boolean')
    issues.push(`${path}.${field} must be a boolean`);
}

function requiredInteger(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: string[],
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  const value = record[field];
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    issues.push(
      `${path}.${field} must be an integer from ${minimum} to ${maximum}`,
    );
  }
}

function requiredLiteral(
  record: Record<string, unknown>,
  field: string,
  expected: string,
  path: string,
  issues: string[],
): void {
  if (record[field] !== expected)
    issues.push(`${path}.${field} must equal ${expected}`);
}

function recordAt(
  value: unknown,
  path: string,
  issues: string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}
