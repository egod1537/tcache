import type { StationMappingSource } from '../common/index.js';

export const GTFS_GENERATOR_VERSION = 'jr-normalized-gtfs/1.0.0' as const;

export const REQUIRED_GTFS_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt',
] as const;

export type RequiredGtfsFile = (typeof REQUIRED_GTFS_FILES)[number];

export interface GtfsAgencyConfig {
  agencyId: string;
  agencyName: string;
  agencyUrl: string;
  agencyTimezone: string;
  agencyLang?: string;
}

export interface GtfsRouteConfig {
  routeType: number;
  routeShortName?: string;
  routeLongName?: string;
  routeColor?: string;
  routeTextColor?: string;
}

export interface GtfsFeedConfig {
  publisherName: string;
  publisherUrl: string;
  language: string;
}

export interface GtfsGeneratorConfig {
  generatorVersion: string;
  agencies: Record<string, GtfsAgencyConfig>;
  routes: Record<string, GtfsRouteConfig>;
  /** Feed-local mapping. GTFS assigns no universal meaning to 0 and 1. */
  directionIds: Record<string, 0 | 1>;
  directionLabels?: Record<string, string>;
  feed: GtfsFeedConfig;
}

export interface GtfsGenerationIssue {
  code:
    | 'NORMALIZED_INVALID'
    | 'MAPPING_DUPLICATE'
    | 'MAPPING_INVALID'
    | 'MAPPING_UNCONFIRMED'
    | 'MAPPING_COORDINATES_MISSING'
    | 'MAPPING_STATION_MISMATCH'
    | 'AGENCY_CONFIG_MISSING'
    | 'ROUTE_CONFIG_MISSING'
    | 'DIRECTION_POLICY_MISSING'
    | 'TRIP_CALLED_STOPS_TOO_FEW'
    | 'STOP_TIME_MISSING'
    | 'GTFS_TIME_REGRESSION';
  path: string;
  message: string;
}

export class GtfsGenerationError extends Error {
  constructor(readonly issues: GtfsGenerationIssue[]) {
    super(
      `GTFS generation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
    );
    this.name = 'GtfsGenerationError';
  }
}

export interface GeneratedGtfsFeed {
  files: ReadonlyMap<RequiredGtfsFile, string>;
  canonicalContentHash: string;
  feedVersion: string;
  counts: {
    agencies: number;
    stops: number;
    routes: number;
    trips: number;
    stopTimes: number;
    calendars: number;
    calendarDates: number;
  };
  unresolvedCalendarConditions: string[];
}

export interface GtfsValidatorSummary {
  validatorName: 'MobilityData GTFS Validator';
  validatorVersion: string;
  command: string;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  reportPath: string;
  reportJsonPath: string;
  warnings: Array<{
    code: string;
    count: number;
    otpImpact: 'none-known' | 'review';
  }>;
}

export interface GtfsBuildManifest {
  schemaVersion: '1.0';
  datasetVersion: string;
  feedVersion: string;
  generatorVersion: string;
  generatedAt: string;
  normalizedManifestHash: string;
  normalizedSourceArtifactHashes: string[];
  stationMapping: {
    sha256: string;
    source: StationMappingSource;
    confirmedMappings: number;
  };
  canonicalContentHash: string;
  zipSha256: string;
  files: Array<{ name: RequiredGtfsFile; sha256: string; bytes: number }>;
  counts: GeneratedGtfsFeed['counts'];
  directionPolicy: Record<string, 0 | 1>;
  unresolvedCalendarConditions: string[];
  scope: {
    purpose: 'personal-education-and-research';
    externalDistribution: false;
    commercialUse: false;
  };
  validator?: GtfsValidatorSummary;
}
