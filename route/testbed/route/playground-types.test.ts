import { describe, expect, it } from 'vitest';

import {
  buildRouteRequest,
  createDefaultRouteDraft,
  createLocationDraft,
  createRouteDraftLocation,
  parseRawRouteRequest,
  createRoutePresetDraft,
  ROUTE_PLAYGROUND_PRESETS,
} from './playground-types.js';

describe('Route Playground request builder', () => {
  it('builds the default ordered location request', () => {
    expect(buildRouteRequest(createDefaultRouteDraft())).toMatchObject({
      locations: [
        {
          name: 'Tokyo Station',
          coordinates: { latitude: 35.681236, longitude: 139.767125 },
        },
        {
          name: 'Shibuya',
          coordinates: { latitude: 35.658034, longitude: 139.701636 },
        },
      ],
      mode: 'DRIVING',
      countryCode: 'JP',
      departureTime: expect.stringMatching(/Z$/),
    });
  });

  it('maps first, middle, and last locations to the request in list order', () => {
    const draft = createDefaultRouteDraft();
    draft.locations = [
      createRouteDraftLocation(createLocationDraft('Tokyo')),
      createRouteDraftLocation(createLocationDraft('Asakusa')),
      createRouteDraftLocation({
        ...createLocationDraft(),
        type: 'coordinates',
        latitude: '35.6762',
        longitude: '139.6503',
      }),
      createRouteDraftLocation(createLocationDraft('Tokyo Tower')),
    ];

    expect(buildRouteRequest(draft)).toMatchObject({
      locations: [
        { address: 'Tokyo' },
        { address: 'Asakusa' },
        { coordinates: { latitude: 35.6762, longitude: 139.6503 } },
        { address: 'Tokyo Tower' },
      ],
      mode: 'DRIVING',
    });
  });

  it('provides Japan and Korea presets with country, mode, and coordinates', () => {
    expect(ROUTE_PLAYGROUND_PRESETS.map((preset) => preset.label)).toEqual([
      'Japan · Tokyo driving',
      'Japan · Tokyo walking',
      'Japan · Tokyo Station → Shibuya transit',
      'Japan · Tokyo Station → Tokyo Tower transit',
      'Japan · Shinjuku → Asakusa transit',
      'Japan · Tokyo Station → Asakusa → Shibuya transit',
      'Korea · Seoul driving',
      'Korea · Seoul walking',
      'Korea · Seoul transit',
    ]);
    const request = buildRouteRequest(
      createRoutePresetDraft(ROUTE_PLAYGROUND_PRESETS[8]!),
    );
    expect(request).toMatchObject({
      mode: 'TRANSIT',
      countryCode: 'KR',
      locations: [
        {
          name: 'Seoul Station',
          coordinates: { latitude: 37.554722, longitude: 126.970833 },
        },
        {
          name: 'Gangnam Station',
          coordinates: { latitude: 37.497942, longitude: 127.027621 },
        },
      ],
      departureTime: expect.stringMatching(/Z$/),
    });
    for (const preset of ROUTE_PLAYGROUND_PRESETS.filter(
      ({ countryCode, mode }) => countryCode === 'JP' && mode === 'TRANSIT',
    )) {
      expect(buildRouteRequest(createRoutePresetDraft(preset))).toMatchObject({
        countryCode: 'JP',
        mode: 'TRANSIT',
        departureTime: expect.stringMatching(/Z$/),
      });
    }
  });

  it('rejects too few locations, empty rows, invalid coordinates, and invalid raw JSON', () => {
    const tooShort = createDefaultRouteDraft();
    tooShort.locations = tooShort.locations.slice(0, 1);
    expect(() => buildRouteRequest(tooShort)).toThrow(
      '출발지와 도착지를 포함해 위치를 2개 이상 입력하세요',
    );

    const emptyStop = createDefaultRouteDraft();
    emptyStop.locations.splice(1, 0, createRouteDraftLocation());
    expect(() => buildRouteRequest(emptyStop)).toThrow(
      '경유지 1 주소를 입력하세요',
    );

    const invalidCoordinates = createDefaultRouteDraft();
    invalidCoordinates.locations[1]!.location = {
      ...createLocationDraft(),
      type: 'coordinates',
      latitude: '100',
      longitude: '139',
    };
    expect(() => buildRouteRequest(invalidCoordinates)).toThrow(
      '도착지 좌표가 올바르지 않습니다',
    );
    expect(() => parseRawRouteRequest('{')).toThrow();
  });
});
