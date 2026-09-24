import type {
  MatrixJobView,
  MatrixRequest,
  MatrixResult,
  PublicRouteLocation,
  RouteTravelMode,
  RouteJobStreamState,
} from '../../../apps/testbed/src/api/client';
import type { RouteLocationDraft } from '../route/playground-types';
import { getMatrixPreset } from './matrix-presets';

export const MIN_MATRIX_LOCATIONS = 2;
export const MAX_MATRIX_LOCATIONS = 20;

export class MatrixSubmissionGuard {
  private active = false;

  tryStart() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  finish() {
    this.active = false;
  }
}

export function shouldUseMatrixPolling(
  job: MatrixJobView | null,
  streamState: RouteJobStreamState,
) {
  return (
    job !== null &&
    !['completed', 'failed', 'cancelled'].includes(job.status) &&
    streamState !== 'connected'
  );
}

export interface MatrixDraftLocation {
  key: string;
  id: string;
  name?: string;
  location: RouteLocationDraft;
}

export interface MatrixRequestDraft {
  locations: MatrixDraftLocation[];
  mode: RouteTravelMode;
  departureTime: string;
  languageCode: string;
  regionCode: string;
  routingPreference: string;
  units: string;
}

export interface TrouteCompatibility {
  valid: boolean;
  checks: Array<{ label: string; valid: boolean; detail?: string }>;
}

let keySequence = 0;

export function createMatrixLocationKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  keySequence += 1;
  return `matrix-location-${keySequence}`;
}

export function createMatrixDraft(presetId = 'tokyo-3'): MatrixRequestDraft {
  const preset = getMatrixPreset(presetId);
  return {
    locations: preset.locations.map((item) => ({
      key: createMatrixLocationKey(),
      id: item.id,
      ...(item.name ? { name: item.name } : {}),
      location: { ...item.location },
    })),
    mode: 'TRANSIT',
    departureTime: createDefaultDepartureTime(),
    languageCode: preset.languageCode,
    regionCode: preset.regionCode,
    routingPreference: '',
    units: '',
  };
}

export function applyMatrixPreset(
  current: MatrixRequestDraft,
  presetId: string,
): MatrixRequestDraft {
  const preset = getMatrixPreset(presetId);
  return {
    ...current,
    locations: preset.locations.map((item) => ({
      key: createMatrixLocationKey(),
      id: item.id,
      ...(item.name ? { name: item.name } : {}),
      location: { ...item.location },
    })),
    languageCode: preset.languageCode,
    regionCode: preset.regionCode,
  };
}

export function addMatrixLocation(
  locations: MatrixDraftLocation[],
): MatrixDraftLocation[] {
  if (locations.length >= MAX_MATRIX_LOCATIONS) return locations;
  const ordinal = locations.length + 1;
  return [
    ...locations,
    {
      key: createMatrixLocationKey(),
      id: `P${ordinal}`,
      location: {
        type: 'address',
        name: '',
        address: '',
        latitude: '',
        longitude: '',
        placeId: '',
        kakaoPlaceId: '',
        navitimeId: '',
        ekispertId: '',
      },
    },
  ];
}

export function reorderMatrixLocations(
  locations: MatrixDraftLocation[],
  sourceKey: string,
  targetKey: string,
): MatrixDraftLocation[] {
  const sourceIndex = locations.findIndex(({ key }) => key === sourceKey);
  const targetIndex = locations.findIndex(({ key }) => key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return locations;
  }
  const next = [...locations];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return locations;
  next.splice(targetIndex, 0, source);
  return next;
}

export function buildMatrixRequest(draft: MatrixRequestDraft): MatrixRequest {
  if (
    draft.locations.length < MIN_MATRIX_LOCATIONS ||
    draft.locations.length > MAX_MATRIX_LOCATIONS
  ) {
    throw new Error(
      `Location은 ${MIN_MATRIX_LOCATIONS}~${MAX_MATRIX_LOCATIONS}개를 입력하세요.`,
    );
  }
  const ids = new Set<string>();
  const locations = draft.locations.map((item, index) => {
    const id = item.id.trim();
    if (!id) throw new Error(`Location ${index + 1}의 ID를 입력하세요.`);
    if (ids.has(id)) throw new Error(`Location ID가 중복됩니다: ${id}`);
    ids.add(id);
    return { id, ...toPublicLocation(item.location, `Location ${id}`) };
  });
  if (!draft.departureTime || Number.isNaN(Date.parse(draft.departureTime))) {
    throw new Error('유효한 출발 시각을 입력하세요.');
  }
  if (draft.mode !== 'DRIVING' && draft.routingPreference) {
    throw new Error(
      'routingPreference는 DRIVING mode에서만 사용할 수 있습니다.',
    );
  }
  const options = {
    ...(draft.languageCode.trim()
      ? { languageCode: draft.languageCode.trim() }
      : {}),
    ...(draft.regionCode.trim() ? { regionCode: draft.regionCode.trim() } : {}),
    ...(draft.routingPreference
      ? { routingPreference: draft.routingPreference }
      : {}),
    ...(draft.units ? { units: draft.units } : {}),
  };
  return {
    locations,
    mode: draft.mode,
    departureTime: new Date(draft.departureTime).toISOString(),
    ...(Object.keys(options).length ? { options } : {}),
  };
}

export function buildTrouteRequestPreview(request: MatrixRequest | null) {
  if (
    !request ||
    request.locations.some((location) => !('placeId' in location))
  ) {
    return null;
  }
  return {
    job_id: 'matrix-testbed-preview',
    locations: request.locations.map((location) => ({
      id: location.id,
      place_id: 'placeId' in location ? location.placeId : '',
      open_time: '00:00',
      close_time: '23:59',
      stay_minutes: 0,
    })),
    start_time: '09:00',
  };
}

function toPublicLocation(
  location: RouteLocationDraft,
  label: string,
): PublicRouteLocation {
  if (location.type === 'placeId') {
    if (!location.placeId.trim())
      throw new Error(`${label} Place ID를 입력하세요.`);
    return { placeId: location.placeId.trim() };
  }
  if (location.type === 'address') {
    if (!location.address.trim())
      throw new Error(`${label} 주소를 입력하세요.`);
    return { address: location.address.trim() };
  }
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (
    !location.latitude.trim() ||
    !location.longitude.trim() ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(`${label} 좌표가 올바르지 않습니다.`);
  }
  return { latitude, longitude };
}

export function validateTrouteCompatibility(
  result: MatrixResult | null,
): TrouteCompatibility {
  if (!result) {
    return {
      valid: false,
      checks: [{ label: '결과 matrix 존재', valid: false }],
    };
  }
  const size = result.locations.length;
  const rowCount = result.durationSeconds.length === size;
  const square = result.durationSeconds.every((row) => row.length === size);
  const diagonal =
    square && result.durationSeconds.every((row, index) => row[index] === 0);
  const values = result.durationSeconds.flat();
  const integers = values.every(
    (value) => Number.isInteger(value) && Number.isFinite(value),
  );
  const nonNegative = values.every((value) => value >= 0);
  const checks = [
    { label: 'location count == matrix size', valid: rowCount },
    { label: '모든 row의 length가 동일', valid: square },
    { label: 'diagonal == 0', valid: diagonal },
    { label: '모든 duration이 integer seconds', valid: integers },
    { label: 'NaN/null 없음, duration >= 0', valid: nonNegative },
  ];
  return { valid: checks.every(({ valid }) => valid), checks };
}

export interface MatrixPairView {
  key: string;
  fromId: string;
  toId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  source: 'cache' | 'provider' | '—';
  durationSeconds: number | null;
}

export function buildMatrixPairViews(
  job: MatrixJobView,
  result: MatrixResult | null,
): MatrixPairView[] {
  const pairs: MatrixPairView[] = [];
  let pairIndex = 0;
  for (let from = 0; from < job.request.locations.length; from += 1) {
    for (let to = 0; to < job.request.locations.length; to += 1) {
      if (from === to) continue;
      const completed = result !== null || pairIndex < job.stats.completedPairs;
      const running =
        !completed &&
        job.status === 'running' &&
        pairIndex === job.stats.completedPairs;
      pairs.push({
        key: `${from}-${to}`,
        fromId: job.request.locations[from]!.id,
        toId: job.request.locations[to]!.id,
        status:
          job.status === 'failed' && running
            ? 'failed'
            : completed
              ? 'completed'
              : running
                ? 'running'
                : 'queued',
        source: '—',
        durationSeconds: result?.durationSeconds[from]?.[to] ?? null,
      });
      pairIndex += 1;
    }
  }
  return pairs;
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function createDefaultDepartureTime() {
  const now = new Date(Date.now() + 15 * 60_000);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
