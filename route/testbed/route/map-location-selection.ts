import type { RouteCoordinate } from '../../../apps/testbed/src/api/client';

import {
  createLocationDraft,
  createRouteDraftLocation,
  type RouteLocationDraft,
  type RouteRequestDraft,
} from './playground-types';
import {
  insertLocationBeforeDestination,
  MAX_ROUTE_LOCATIONS,
} from './route-locations';

export interface MapLocationSelection {
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string;
}

export type MapLocationTarget = 'origin' | 'stop' | 'destination';

export interface MapSelectionState {
  selection: MapLocationSelection | null;
  error: string | null;
}

export type MapSelectionAction =
  | {
      type: 'select';
      selection: MapLocationSelection;
      disabled?: boolean;
    }
  | { type: 'cancel' }
  | { type: 'limit-reached' };

export interface MapClickEventLike {
  latLng: { lat(): number; lng(): number } | null;
  placeId?: string;
}

export interface RequestMapMarker {
  kind: 'origin' | 'intermediate' | 'destination';
  index?: number;
  position: RouteCoordinate;
}

export const EMPTY_MAP_SELECTION_STATE: MapSelectionState = {
  selection: null,
  error: null,
};

export function mapClickEventToSelection(
  event: MapClickEventLike,
): MapLocationSelection | null {
  if (!event.latLng) return null;

  const lat = event.latLng.lat();
  const lng = event.latLng.lng();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    ...(event.placeId ? { placeId: event.placeId } : {}),
  };
}

export function mapSelectionReducer(
  state: MapSelectionState,
  action: MapSelectionAction,
): MapSelectionState {
  if (action.type === 'select') {
    return action.disabled
      ? state
      : { selection: action.selection, error: null };
  }
  if (action.type === 'limit-reached') {
    return state.selection
      ? { ...state, error: '경유지는 최대 25개까지 추가할 수 있습니다.' }
      : state;
  }
  return EMPTY_MAP_SELECTION_STATE;
}

export function locationDraftFromMapSelection(
  selection: MapLocationSelection,
): RouteLocationDraft {
  if (selection.placeId) {
    return {
      ...createLocationDraft(),
      type: 'placeId',
      placeId: selection.placeId,
    };
  }

  return {
    ...createLocationDraft(),
    type: 'coordinates',
    latitude: formatCoordinate(selection.lat),
    longitude: formatCoordinate(selection.lng),
  };
}

export function applyMapLocationSelection(
  draft: RouteRequestDraft,
  selection: MapLocationSelection,
  target: MapLocationTarget,
): { draft: RouteRequestDraft; applied: boolean; error?: string } {
  const location = locationDraftFromMapSelection(selection);
  if (target === 'origin') {
    const locations = draft.locations.length
      ? draft.locations.map((item, index) =>
          index === 0 ? { ...item, location } : item,
        )
      : [createRouteDraftLocation(location)];
    return { draft: { ...draft, locations }, applied: true };
  }
  if (target === 'destination') {
    const locations =
      draft.locations.length === 0
        ? [createRouteDraftLocation(location)]
        : draft.locations.length === 1
          ? [...draft.locations, createRouteDraftLocation(location)]
          : draft.locations.map((item, index) =>
              index === draft.locations.length - 1
                ? { ...item, location }
                : item,
            );
    return { draft: { ...draft, locations }, applied: true };
  }
  if (draft.locations.length >= MAX_ROUTE_LOCATIONS) {
    return {
      draft,
      applied: false,
      error: '경유지는 최대 25개까지 추가할 수 있습니다.',
    };
  }
  return {
    draft: {
      ...draft,
      locations: insertLocationBeforeDestination(
        draft.locations,
        createRouteDraftLocation(location),
      ),
    },
    applied: true,
  };
}

export function locationMarkerKey(location: RouteLocationDraft): string | null {
  if (location.type === 'placeId') {
    const placeId = location.placeId.trim();
    return placeId ? `placeId:${placeId}` : null;
  }
  if (location.type === 'coordinates') {
    if (!location.latitude.trim() || !location.longitude.trim()) return null;
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    return Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
      ? `coordinates:${latitude},${longitude}`
      : null;
  }
  return null;
}

export function mapSelectionMarkerKey(selection: MapLocationSelection): string {
  return selection.placeId
    ? `placeId:${selection.placeId}`
    : `coordinates:${selection.lat},${selection.lng}`;
}

export function buildRequestMapMarkers(
  draft: RouteRequestDraft,
  knownPositions: Readonly<Record<string, RouteCoordinate>>,
  fallbackPositions: ReadonlyArray<RouteCoordinate | null | undefined> = [],
): RequestMapMarker[] {
  return draft.locations.flatMap<RequestMapMarker>((item, locationIndex) => {
    const key = locationMarkerKey(item.location);
    const directPosition = coordinateFromLocation(item.location);
    const position =
      fallbackPositions[locationIndex] ??
      directPosition ??
      (key ? knownPositions[key] : undefined);
    if (!position) return [];

    if (locationIndex === 0) {
      return [{ kind: 'origin' as const, position }];
    }
    if (locationIndex === draft.locations.length - 1) {
      return [{ kind: 'destination' as const, position }];
    }
    return [
      {
        kind: 'intermediate' as const,
        index: locationIndex,
        position,
      },
    ];
  });
}

export function buildResultMapMarkers(
  positions: ReadonlyArray<RouteCoordinate | null | undefined>,
): RequestMapMarker[] {
  return positions.flatMap<RequestMapMarker>((position, index) => {
    if (!position) return [];
    if (index === 0) return [{ kind: 'origin', position }];
    if (index === positions.length - 1) {
      return [{ kind: 'destination', position }];
    }
    return [{ kind: 'intermediate', index, position }];
  });
}

function coordinateFromLocation(
  location: RouteLocationDraft,
): RouteCoordinate | null {
  if (location.type !== 'coordinates') return null;
  if (!location.latitude.trim() || !location.longitude.trim()) return null;
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}
