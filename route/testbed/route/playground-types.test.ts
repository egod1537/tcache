import { describe, expect, it } from 'vitest';

import {
  buildRouteRequest,
  createDefaultRouteDraft,
  createLocationDraft,
  createRouteDraftLocation,
  parseRawRouteRequest,
} from './playground-types.js';

describe('Route Playground request builder', () => {
  it('builds the default ordered location request', () => {
    expect(buildRouteRequest(createDefaultRouteDraft())).toMatchObject({
      locations: [{ address: '東京駅、日本' }, { address: '東京タワー、日本' }],
      mode: 'DRIVING',
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
        { latitude: 35.6762, longitude: 139.6503 },
        { address: 'Tokyo Tower' },
      ],
      mode: 'DRIVING',
    });
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
