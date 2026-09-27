export const NORMALIZED_SCHEMA_VERSION = '1.0' as const;
export const RAW_ARTIFACT_SCHEMA_VERSION = '1.0' as const;

export interface ServiceDayTime {
  /** Number of midnights crossed since the start of the service day. */
  dayOffset: number;
  hour: number;
  minute: number;
  second: number;
}

export interface Operator {
  id: string;
  nameJa: string;
  nameEn?: string;
}

export interface Line {
  id: string;
  operatorId: string;
  nameJa: string;
  nameEn?: string;
}

export interface Station {
  id: string;
  operatorId: string;
  nameJa: string;
  nameEn?: string;
  stationNumber?: string;
}

export interface ServiceCalendarException {
  date: string;
  serviceAdded: boolean;
}

export interface ServiceCalendar {
  id: string;
  startDate: string;
  endDate: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  exceptions: ServiceCalendarException[];
  calendarConfidence?: 'explicit-page-label' | 'detail-calendar' | 'unresolved';
  unresolvedCalendarConditions?: string[];
  sourceReferences?: SourceReference[];
}

export interface SourceReference {
  artifactSha256: string;
  sourceUrl: string;
  sourceType: string;
  sourceEdition: string;
  sourceUrlKey?: string;
  sourceStationKey?: string;
}

export interface StopTime {
  stationId: string;
  sequence: number;
  arrival?: ServiceDayTime;
  departure?: ServiceDayTime;
  platform?: string;
  passThrough: boolean;
  sourceReference?: SourceReference;
}

export interface Trip {
  internalTripId: string;
  operator: string;
  lineId: string;
  direction: string;
  trainNumber: string;
  trainType: string;
  originStationId: string;
  destinationStationId: string;
  serviceId: string;
  sourceEdition: string;
  sourceUrl: string;
  sourceReference: SourceReference;
  operationConditions?: string[];
  stopTimes: StopTime[];
}

export interface DatasetMetadata {
  operator: string;
  timetableEdition: string;
  parserVersion: string;
  sourceArtifactHashes: string[];
  datasetVersion: string;
  manifestHash: string;
  generatedAt: string;
}

export interface NormalizedTimetable {
  schemaVersion: typeof NORMALIZED_SCHEMA_VERSION;
  metadata: DatasetMetadata;
  operators: Operator[];
  lines: Line[];
  stations: Station[];
  serviceCalendars: ServiceCalendar[];
  trips: Trip[];
}

export type MappingStatus = 'unmapped' | 'candidate' | 'confirmed' | 'rejected';
export type OsmElementType = 'node' | 'way' | 'relation';

export interface StationMapping {
  internalStationId: string;
  operator: string;
  officialNameJa: string;
  officialNameEn?: string;
  sourceStationKey?: string;
  stationNumber?: string;
  osmElementType?: OsmElementType;
  osmElementId?: number;
  latitude?: number;
  longitude?: number;
  mappingStatus: MappingStatus;
  reviewedAt?: string;
}

export interface StationMappingSource {
  name: string;
  url: string;
  license?: string;
  attribution?: string;
  retrievedAt: string;
  routeRelationIds?: number[];
}

export interface StationMappingSet {
  schemaVersion: '1.0';
  operator: string;
  lineId?: string;
  reviewMethod: string;
  source: StationMappingSource;
  mappings: StationMapping[];
}

export interface RawArtifactManifest {
  schemaVersion: typeof RAW_ARTIFACT_SCHEMA_VERSION;
  sourceUrl: string;
  requestedAt: string;
  httpStatus: number;
  contentType: string;
  sha256: string;
  byteLength: number;
  sourceEdition: string;
  sourceType: string;
  operator: string;
  collectorVersion: string;
}
