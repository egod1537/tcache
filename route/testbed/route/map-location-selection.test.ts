import { describe, expect, it } from 'vitest';

import {
  applyMapLocationSelection,
  buildRequestMapMarkers,
  buildResultMapMarkers,
  EMPTY_MAP_SELECTION_STATE,
  mapClickEventToSelection,
  mapSelectionReducer,
} from './map-location-selection.js';
import {
  createDefaultRouteDraft,
  createLocationDraft,
  createRouteDraftLocation,
} from './playground-types.js';

describe('Route Playground map location selection', () => {
  it('creates coordinate and POI selections from map clicks', () => {
    expect(
      mapClickEventToSelection({
        latLng: { lat: () => 35.681236, lng: () => 139.767125 },
      }),
    ).toEqual({ lat: 35.681236, lng: 139.767125 });
    expect(
      mapClickEventToSelection({
        latLng: { lat: () => 35.71, lng: () => 139.81 },
        placeId: 'ChIJ-example',
      }),
    ).toEqual({ lat: 35.71, lng: 139.81, placeId: 'ChIJ-example' });
  });

  it('replaces the ordered origin and destination using normalized location types', () => {
    const draft = createDefaultRouteDraft();
    const origin = applyMapLocationSelection(
      draft,
      { lat: 35.681236, lng: 139.767125 },
      'origin',
    );
    const destination = applyMapLocationSelection(
      origin.draft,
      { lat: 35.6586, lng: 139.7454, placeId: 'ChIJ-destination' },
      'destination',
    );

    expect(destination.draft.locations[0]?.location).toMatchObject({
      type: 'coordinates',
      latitude: '35.681236',
      longitude: '139.767125',
    });
    expect(destination.draft.locations.at(-1)?.location).toMatchObject({
      type: 'placeId',
      placeId: 'ChIJ-destination',
    });
    expect(destination.draft.locations[0]?.id).toBe(draft.locations[0]?.id);
  });

  it('inserts a map stop immediately before Destination', () => {
    const draft = createDefaultRouteDraft();
    const result = applyMapLocationSelection(
      draft,
      { lat: 35.7, lng: 139.7 },
      'stop',
    );

    expect(result.draft.locations).toHaveLength(3);
    expect(result.draft.locations[1]?.location).toMatchObject({
      type: 'coordinates',
      latitude: '35.7',
      longitude: '139.7',
    });
    expect(result.draft.locations[2]?.id).toBe(draft.locations[1]?.id);
  });

  it('refuses a map stop after 25 intermediates', () => {
    const draft = createDefaultRouteDraft();
    draft.locations = Array.from({ length: 27 }, (_, index) =>
      createRouteDraftLocation(createLocationDraft(`Location ${index}`)),
    );
    const rejected = applyMapLocationSelection(
      draft,
      { lat: 35.8, lng: 139.8 },
      'stop',
    );
    expect(rejected).toMatchObject({
      applied: false,
      error: '경유지는 최대 25개까지 추가할 수 있습니다.',
    });
    expect(rejected.draft).toBe(draft);
  });

  it('cancels, replaces an open selection, and ignores selection while pending', () => {
    const first = { lat: 35.1, lng: 139.1 };
    const second = { lat: 35.2, lng: 139.2, placeId: 'second' };
    const selected = mapSelectionReducer(EMPTY_MAP_SELECTION_STATE, {
      type: 'select',
      selection: first,
    });
    const replaced = mapSelectionReducer(selected, {
      type: 'select',
      selection: second,
    });
    expect(replaced.selection).toEqual(second);
    expect(
      mapSelectionReducer(replaced, {
        type: 'select',
        selection: first,
        disabled: true,
      }),
    ).toBe(replaced);
    expect(mapSelectionReducer(replaced, { type: 'cancel' })).toEqual(
      EMPTY_MAP_SELECTION_STATE,
    );
  });

  it('keeps marker labels aligned with the ordered location list', () => {
    const draft = createDefaultRouteDraft();
    draft.locations = [
      createRouteDraftLocation({
        ...createLocationDraft(),
        type: 'coordinates',
        latitude: '35.1',
        longitude: '139.1',
      }),
      createRouteDraftLocation({
        ...createLocationDraft(),
        type: 'placeId',
        placeId: 'poi-1',
      }),
      createRouteDraftLocation(createLocationDraft('Destination')),
    ];

    expect(
      buildRequestMapMarkers(
        draft,
        { 'placeId:poi-1': { lat: 35.2, lng: 139.2 } },
        [null, null, { lat: 35.3, lng: 139.3 }],
      ),
    ).toEqual([
      { kind: 'origin', position: { lat: 35.1, lng: 139.1 } },
      {
        kind: 'intermediate',
        index: 1,
        position: { lat: 35.2, lng: 139.2 },
      },
      { kind: 'destination', position: { lat: 35.3, lng: 139.3 } },
    ]);
  });

  it('does not treat blank coordinate fields as zero coordinates', () => {
    const draft = createDefaultRouteDraft();
    draft.locations[0]!.location = {
      ...createLocationDraft(),
      type: 'coordinates',
    };
    draft.locations.splice(1, 1);
    expect(buildRequestMapMarkers(draft, {})).toEqual([]);
  });

  it('keeps all result endpoints visible for a submitted raw request', () => {
    expect(
      buildResultMapMarkers([
        { lat: 35.1, lng: 139.1 },
        { lat: 35.2, lng: 139.2 },
        { lat: 35.3, lng: 139.3 },
      ]),
    ).toEqual([
      { kind: 'origin', position: { lat: 35.1, lng: 139.1 } },
      {
        kind: 'intermediate',
        index: 1,
        position: { lat: 35.2, lng: 139.2 },
      },
      { kind: 'destination', position: { lat: 35.3, lng: 139.3 } },
    ]);
  });
});
