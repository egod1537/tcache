import type {
  RawArtifactManifest,
  ServiceDayTime,
  SourceReference,
} from '../common/index.js';

export type YamanoteDirection = 'outer' | 'inner';
export type JrEastDirection = string;
export type YamanoteService = 'weekday' | 'holiday';

export type JrEastFailureCode =
  | 'FETCH_FAILED'
  | 'PAGE_STRUCTURE_CHANGED'
  | 'PARSE_FAILED'
  | 'AMBIGUOUS_TRIP'
  | 'CALENDAR_UNRESOLVED'
  | 'TIME_ORDER_INVALID'
  | 'STATION_MAPPING_MISSING';

export interface ObservedEdition {
  observedRawEditionKey: string;
  humanReadableLabel?: string;
  evidence: string;
}

export interface JrEastSource {
  lineKey: string;
  direction: JrEastDirection;
  service: YamanoteService;
  directionLabel: string;
  serviceLabel: string;
  matrixUrl: string;
  stationTimetableUrl: string;
}

export type YamanoteSource = JrEastSource;

export interface SourceDiscovery {
  edition: ObservedEdition;
  sourceIndexUrl: string;
  sources: JrEastSource[];
}

export interface ParsedMatrixStop {
  stationNameJa: string;
  sourceStationKey?: string;
  sequence: number;
  arrival?: ServiceDayTime;
  departure?: ServiceDayTime;
  platform?: string;
  passThrough: boolean;
  sourceReference?: SourceReference;
}

export interface MatrixTripCandidate {
  trainNumber: string;
  trainType: string;
  operationCondition: string;
  direction: JrEastDirection;
  service: YamanoteService;
  columnIndex: number;
  sourceReference: SourceReference;
  stops: ParsedMatrixStop[];
}

export interface ParsedMatrixPage {
  direction: JrEastDirection;
  directionLabel: string;
  service: YamanoteService;
  serviceLabel: string;
  stationRowCount: number;
  candidates: MatrixTripCandidate[];
  diagnostics: PipelineDiagnostic[];
  manifest: RawArtifactManifest;
}

export interface ParsedDetailStop extends ParsedMatrixStop {
  platform?: string;
}

export interface DetailTripCandidate {
  trainNumber: string;
  trainType: string;
  operationConditions: string[];
  sourceReference: SourceReference;
  direction?: JrEastDirection;
  service?: YamanoteService;
  stops: ParsedDetailStop[];
}

export interface ParsedTrainDetail {
  candidates: DetailTripCandidate[];
  calendarStart?: string;
  calendarEnd?: string;
  explicitServiceDates: string[];
  manifest: RawArtifactManifest;
}

export interface ConflictRecord {
  code: 'MATRIX_DETAIL_CONFLICT' | 'AMBIGUOUS_DETAIL_MATCH';
  trainNumber: string;
  direction: JrEastDirection;
  service: YamanoteService;
  matrixSourceUrl: string;
  detailSourceUrl: string;
  differences: string[];
}

export interface PipelineDiagnostic {
  code: JrEastFailureCode;
  severity: 'error' | 'warning';
  message: string;
  sourceUrl?: string;
  tripId?: string;
}
