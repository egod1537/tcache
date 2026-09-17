import { describe, expect, it } from 'vitest';

import { buildRequestMapMarkers } from './map-location-selection.js';
import {
  buildRouteRequest,
  createDefaultRouteDraft,
  createLocationDraft,
  createRouteDraftLocation,
} from './playground-types.js';
import {
  getRouteLocationRole,
  insertLocationBeforeDestination,
  keyboardReorderTarget,
  MAX_ROUTE_LOCATIONS,
  removeRouteLocation,
  reorderRouteLocations,
} from './route-locations.js';

function locations(...names: string[]) {
  return names.map((name) =>
    createRouteDraftLocation(createLocationDraft(name), name),
  );
}

describe('ordered Route Playground locations', () => {
  it('adds a location immediately before Destination with a stable id', () => {
    const current = locations('Tokyo Station', 'Tokyo Tower');
    const added = createRouteDraftLocation(createLocationDraft('Asakusa'), 'a');
    const next = insertLocationBeforeDestination(current, added);

    expect(next.map((item) => item.id)).toEqual([
      'Tokyo Station',
      'a',
      'Tokyo Tower',
    ]);
    expect(next[1]).toBe(added);
  });

  it('removes a location and derives roles from the remaining order', () => {
    const next = removeRouteLocation(locations('A', 'B', 'C'), 'B');
    expect(next.map((item) => item.id)).toEqual(['A', 'C']);
    expect(getRouteLocationRole(0, next.length)).toBe('origin');
    expect(getRouteLocationRole(1, next.length)).toBe('destination');
    expect(getRouteLocationRole(0, 1)).toBe('origin');
  });

  it('moves Origin into the middle and recalculates every role', () => {
    const next = reorderRouteLocations(locations('A', 'B', 'C'), 'A', 1);
    expect(next.map((item) => item.id)).toEqual(['B', 'A', 'C']);
    expect(
      next.map((_, index) => getRouteLocationRole(index, next.length)),
    ).toEqual(['origin', 'stop', 'destination']);
  });

  it('moves Destination to the first position', () => {
    const next = reorderRouteLocations(locations('A', 'B', 'C'), 'C', 0);
    expect(next.map((item) => item.id)).toEqual(['C', 'A', 'B']);
    expect(getRouteLocationRole(0, next.length)).toBe('origin');
    expect(getRouteLocationRole(2, next.length)).toBe('destination');
  });

  it('updates map marker roles and numbering after reorder', () => {
    const draft = createDefaultRouteDraft();
    draft.locations = ['A', 'B', 'C'].map((id, index) =>
      createRouteDraftLocation(
        {
          ...createLocationDraft(),
          type: 'coordinates',
          latitude: String(35 + index),
          longitude: String(139 + index),
        },
        id,
      ),
    );
    draft.locations = reorderRouteLocations(draft.locations, 'C', 0);

    expect(buildRequestMapMarkers(draft, {})).toEqual([
      { kind: 'origin', position: { lat: 37, lng: 141 } },
      { kind: 'intermediate', index: 1, position: { lat: 35, lng: 139 } },
      { kind: 'destination', position: { lat: 36, lng: 140 } },
    ]);
  });

  it('uses reordered list order in the public route request', () => {
    const draft = createDefaultRouteDraft();
    draft.locations = reorderRouteLocations(
      locations('Tokyo Station', 'Asakusa', 'Tokyo Tower'),
      'Tokyo Tower',
      0,
    );
    expect(buildRouteRequest(draft)).toMatchObject({
      locations: [
        { address: 'Tokyo Tower' },
        { address: 'Tokyo Station' },
        { address: 'Asakusa' },
      ],
      mode: 'DRIVING',
    });
  });

  it('supports Alt+Arrow keyboard targets and disables them while pending', () => {
    expect(keyboardReorderTarget(1, 'ArrowUp', true)).toBe(0);
    expect(keyboardReorderTarget(1, 'ArrowDown', true)).toBe(2);
    expect(keyboardReorderTarget(1, 'ArrowDown', false)).toBeNull();
    expect(keyboardReorderTarget(1, 'ArrowDown', true, true)).toBeNull();
  });

  it('blocks additions above 25 intermediate locations', () => {
    const full = Array.from({ length: MAX_ROUTE_LOCATIONS }, (_, index) =>
      createRouteDraftLocation(
        createLocationDraft(String(index)),
        String(index),
      ),
    );
    expect(insertLocationBeforeDestination(full)).toBe(full);
  });
});
