import { hashCanonicalJson } from './hash.js';
import { normalizeIdComponent } from './ids.js';
import type { DatasetMetadata } from './types.js';

export interface DatasetIdentityInput {
  operator: string;
  timetableEdition: string;
  sourceArtifactHashes: readonly string[];
  parserVersion: string;
}

export interface DatasetIdentity {
  datasetVersion: string;
  manifestHash: string;
}

export function createDatasetIdentity(
  input: DatasetIdentityInput,
): DatasetIdentity {
  const identityDocument = {
    operator: input.operator,
    timetableEdition: input.timetableEdition,
    sourceArtifactHashes: [...new Set(input.sourceArtifactHashes)].sort(),
    parserVersion: input.parserVersion,
  };
  const manifestHash = hashCanonicalJson(identityDocument);
  return {
    datasetVersion: `${normalizeIdComponent(input.operator)}:${normalizeIdComponent(input.timetableEdition)}:${manifestHash.slice(0, 16)}`,
    manifestHash,
  };
}

export function createDatasetMetadata(
  input: DatasetIdentityInput,
  generatedAt: string,
): DatasetMetadata {
  const identity = createDatasetIdentity(input);
  return {
    operator: input.operator,
    timetableEdition: input.timetableEdition,
    parserVersion: input.parserVersion,
    sourceArtifactHashes: [...new Set(input.sourceArtifactHashes)].sort(),
    ...identity,
    generatedAt,
  };
}
