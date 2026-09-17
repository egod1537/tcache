import { describe, expect, it } from 'vitest';

import {
  buildRouteRequest,
  createDefaultRouteDraft,
  createLocationDraft,
  parseRawRouteRequest,
} from './playground-types.js';

describe('Route Playground request builder', () => {
  it('builds the default address request', () => {
    expect(buildRouteRequest(createDefaultRouteDraft())).toMatchObject({
      origin: { type: 'address', address: '東京駅、日本' },
      intermediates: [],
      destination: { type: 'address', address: '東京タワー、日本' },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: false,
    });
  });

  it('removes empty intermediates while preserving populated order', () => {
    const draft = createDefaultRouteDraft();
    draft.intermediates = [
      createLocationDraft('浅草寺、日本'),
      createLocationDraft(),
      {
        ...createLocationDraft(),
        type: 'coordinates',
        latitude: '35.6762',
        longitude: '139.6503',
      },
    ];

    expect(buildRouteRequest(draft).intermediates).toEqual([
      { type: 'address', address: '浅草寺、日本' },
      { type: 'coordinates', latitude: 35.6762, longitude: 139.6503 },
    ]);
  });

  it('rejects missing endpoints, invalid coordinates, and invalid raw JSON', () => {
    const missingOrigin = createDefaultRouteDraft();
    missingOrigin.origin.address = '';
    expect(() => buildRouteRequest(missingOrigin)).toThrow(
      'Origin address is required',
    );

    const invalidCoordinates = createDefaultRouteDraft();
    invalidCoordinates.destination = {
      ...createLocationDraft(),
      type: 'coordinates',
      latitude: '100',
      longitude: '139',
    };
    expect(() => buildRouteRequest(invalidCoordinates)).toThrow(
      'Destination coordinates are invalid',
    );
    expect(() => parseRawRouteRequest('{')).toThrow();
  });
});
