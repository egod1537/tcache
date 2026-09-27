import { createLineId, createStationId } from '../common/ids.js';
import type {
  CollectionRequest,
  TimetableCollector,
  TimetableParser,
} from '../common/contracts.js';

export const JR_EAST_OPERATOR_ID = 'jr-east' as const;

export interface JrEastCollectionRequest extends CollectionRequest {
  operator: typeof JR_EAST_OPERATOR_ID;
  /** Upstream key is provenance only and must not be used as the internal station ID. */
  sourceStationKey?: string;
}

export type JrEastCollector = TimetableCollector<JrEastCollectionRequest>;
export type JrEastParser = TimetableParser;

export function createJrEastStationId(stableStationKey: string): string {
  return createStationId(JR_EAST_OPERATOR_ID, stableStationKey);
}

export function createJrEastLineId(stableLineKey: string): string {
  return createLineId(JR_EAST_OPERATOR_ID, stableLineKey);
}

export * from './collector.js';
export * from './detail-parser.js';
export * from './errors.js';
export * from './line-registry.js';
export * from './matrix-parser.js';
export * from './merge-expanded.js';
export * from './model.js';
export * from './output.js';
export * from './pipeline.js';
export * from './reconcile.js';
export * from './source-discovery.js';
