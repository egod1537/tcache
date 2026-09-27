import { formatServiceDayTime } from './time.js';
import type { ServiceDayTime } from './types.js';

export interface TripIdParts {
  operator: string;
  edition: string;
  line: string;
  direction: string;
  trainNumber: string;
  origin: string;
  firstDeparture: ServiceDayTime;
  variant: string;
}

export function normalizeIdComponent(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_/.:]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized.length === 0) {
    throw new Error('ID components must contain at least one letter or number');
  }
  return normalized;
}

export function createStationId(
  operator: string,
  stableStationKey: string,
): string {
  const normalizedStationKey = normalizeIdComponent(stableStationKey);
  if (/^\d+$/.test(normalizedStationKey)) {
    throw new Error(
      'A numeric upstream key cannot be used as a persistent station ID',
    );
  }
  return `${normalizeIdComponent(operator)}:${normalizedStationKey}`;
}

export function createLineId(operator: string, stableLineKey: string): string {
  return `${normalizeIdComponent(operator)}:${normalizeIdComponent(stableLineKey)}`;
}

export function createTripId(parts: TripIdParts): string {
  const values = [
    parts.operator,
    parts.edition,
    parts.line,
    parts.direction,
    parts.trainNumber,
    parts.origin,
    formatServiceDayTime(parts.firstDeparture),
    parts.variant,
  ].map(normalizeIdComponent);
  return values.join(':');
}
