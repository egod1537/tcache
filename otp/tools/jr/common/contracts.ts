import type { NormalizedTimetable, RawArtifactManifest } from './types.js';

export interface CollectionRequest {
  sourceUrl: string;
  sourceEdition: string;
  sourceType: string;
  operator: string;
}

export interface CollectedResponse {
  request: CollectionRequest;
  requestedAt: string;
  httpStatus: number;
  contentType: string;
  body: Uint8Array;
}

export interface StoredRawArtifact {
  manifest: RawArtifactManifest;
  manifestHash: string;
  artifactPath: string;
  manifestPath: string;
}

export interface StoredNormalizedDataset {
  datasetVersion: string;
  manifestHash: string;
  datasetHash: string;
  datasetPath: string;
}

export interface TimetableCollector<
  Request extends CollectionRequest = CollectionRequest,
> {
  readonly collectorVersion: string;
  collect(request: Request): Promise<CollectedResponse>;
}

export interface RawArtifactStore {
  put(
    response: CollectedResponse,
    collectorVersion: string,
  ): Promise<StoredRawArtifact>;
}

export interface NormalizedDatasetStore {
  put(dataset: NormalizedTimetable): Promise<StoredNormalizedDataset>;
}

export interface ParserInput {
  manifest: RawArtifactManifest;
  body: Uint8Array;
}

export interface TimetableParser {
  readonly parserVersion: string;
  supports(manifest: RawArtifactManifest): boolean;
  parse(input: ParserInput): Promise<NormalizedTimetable>;
}

export async function collectAndStore<Request extends CollectionRequest>(
  collector: TimetableCollector<Request>,
  request: Request,
  store: RawArtifactStore,
): Promise<StoredRawArtifact> {
  const response = await collector.collect(request);
  return store.put(response, collector.collectorVersion);
}
