import {
  createRouteDraftLocation,
  type RouteDraftLocation,
  type RouteLocationDraft,
} from './playground-types';

export const MAX_ROUTE_LOCATIONS = 27;

export type RouteLocationRole = 'origin' | 'stop' | 'destination';

export function getRouteLocationRole(
  index: number,
  locationCount: number,
): RouteLocationRole {
  if (index === 0) return 'origin';
  if (index === locationCount - 1) return 'destination';
  return 'stop';
}

export function getRouteLocationRoleLabel(role: RouteLocationRole): string {
  if (role === 'origin') return '출발지';
  if (role === 'destination') return '도착지';
  return '경유지';
}

export function getRouteLocationDisplayName(
  location: RouteLocationDraft,
  fallback: string,
): string {
  if (location.name.trim()) return location.name.trim();
  if (location.type === 'address') return location.address.trim() || fallback;
  if (location.type === 'placeId') return location.placeId.trim() || fallback;
  if (location.latitude.trim() && location.longitude.trim()) {
    return `${location.latitude.trim()}, ${location.longitude.trim()}`;
  }
  return fallback;
}

export function insertLocationBeforeDestination(
  locations: RouteDraftLocation[],
  item: RouteDraftLocation = createRouteDraftLocation(),
): RouteDraftLocation[] {
  if (locations.length >= MAX_ROUTE_LOCATIONS) return locations;
  const insertionIndex =
    locations.length < 2 ? locations.length : locations.length - 1;
  return [
    ...locations.slice(0, insertionIndex),
    item,
    ...locations.slice(insertionIndex),
  ];
}

export function reorderRouteLocations(
  locations: RouteDraftLocation[],
  locationId: string,
  targetIndex: number,
): RouteDraftLocation[] {
  const sourceIndex = locations.findIndex((item) => item.id === locationId);
  if (sourceIndex < 0 || !Number.isFinite(targetIndex)) return locations;

  const next = [...locations];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return locations;
  const insertionIndex = Math.min(
    Math.max(0, Math.trunc(targetIndex)),
    next.length,
  );
  next.splice(insertionIndex, 0, moved);
  if (next.every((item, index) => item === locations[index])) return locations;
  return next;
}

export function removeRouteLocation(
  locations: RouteDraftLocation[],
  locationId: string,
): RouteDraftLocation[] {
  const next = locations.filter((item) => item.id !== locationId);
  return next.length === locations.length ? locations : next;
}

export function keyboardReorderTarget(
  sourceIndex: number,
  key: string,
  altKey: boolean,
  disabled = false,
): number | null {
  if (disabled || !altKey) return null;
  if (key === 'ArrowUp') return sourceIndex - 1;
  if (key === 'ArrowDown') return sourceIndex + 1;
  return null;
}
