export const PRIVATE_CORE_ADAPTER_VERSION =
  'odpt-station-timetable/1.0.0' as const;

export interface PrivateLineConfig {
  sourceKey: string;
  nameJa: string;
  nameEn?: string;
  routeShortName?: string;
  routeColor?: string;
}

export interface PrivateOperatorConfig {
  operatorId: string;
  sourceOperator: string;
  nameJa: string;
  nameEn: string;
  website: string;
  lines: PrivateLineConfig[];
}

export interface OdptAdapterInput {
  operator: PrivateOperatorConfig;
  railways: unknown;
  stations: unknown;
  stationTimetables: unknown;
  sourceArtifactHashes: string[];
  sourceUrls: {
    railways: string;
    stations: string;
    stationTimetables: string;
  };
  sourceEdition: string;
  serviceStartDate: string;
  serviceEndDate: string;
  generatedAt: string;
}

export interface OdptAdapterResult {
  dataset: import('../common/index.js').NormalizedTimetable;
  mappingCandidates: import('../common/index.js').StationMappingSet;
  diagnostics: {
    ignoredRailways: string[];
    ignoredTimetables: number;
    skippedTripCandidates: Array<{ key: string; reason: string }>;
    throughServiceMerges: 0;
  };
}
