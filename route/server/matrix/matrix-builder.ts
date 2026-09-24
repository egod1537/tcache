export interface DirectedPair {
  fromIndex: number;
  toIndex: number;
}

export function buildDirectedPairs(locationCount: number): DirectedPair[] {
  const pairs: DirectedPair[] = [];
  for (let fromIndex = 0; fromIndex < locationCount; fromIndex += 1) {
    for (let toIndex = 0; toIndex < locationCount; toIndex += 1) {
      if (fromIndex !== toIndex) pairs.push({ fromIndex, toIndex });
    }
  }
  return pairs;
}

export function createEmptyDurationMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

export function extractDurationSeconds(result: unknown): number {
  const body = record(result);
  const routes = body?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('Route result does not contain a route');
  }
  const route = record(routes[0]);
  const numeric = route?.durationSeconds;
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }
  const duration = route?.duration;
  if (typeof duration === 'string' && /^\d+(?:\.\d{1,9})?s$/.test(duration)) {
    return Math.ceil(Number(duration.slice(0, -1)));
  }
  throw new Error('Route result does not contain a valid duration');
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
