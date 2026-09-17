import { describe, expect, it } from 'vitest';

import {
  canonicalizeRouteLocation,
  getRouteTemporalMetadata,
  ROUTE_COORDINATE_PRECISION,
} from './cache/canonical.js';
import { createRouteCacheKey } from './cache/key.js';
import {
  normalizePublicRouteRequest,
  normalizeRouteRequest,
} from './types/route.js';

const departureTime = '2026-10-02T14:23:00+09:00';

function publicRequest(locations: unknown[]) {
  return { locations, mode: 'TRANSIT', departureTime };
}

describe('public route request normalization', () => {
  it('maps an ordered location list to origin, intermediates, and destination', () => {
    const normalized = normalizePublicRouteRequest(
      publicRequest([
        { placeId: ' A ' },
        { address: ' 東京駅、日本 ' },
        { latitude: 35.6812, longitude: 139.7671 },
      ]),
    );

    expect(normalized).toMatchObject({
      origin: { type: 'placeId', placeId: 'A' },
      intermediates: [{ type: 'address', address: '東京駅、日本' }],
      destination: {
        type: 'coordinates',
        latitude: 35.6812,
        longitude: 139.7671,
      },
      travelMode: 'TRANSIT',
      departureTime,
    });
    expect(normalized.waypoints).toEqual(normalized.intermediates);
  });

  it.each([2, 27])('accepts %s ordered locations', (length) => {
    const locations = Array.from({ length }, (_, index) => ({
      placeId: `place-${index}`,
    }));
    const normalized = normalizePublicRouteRequest(publicRequest(locations));

    expect(normalized.intermediates).toHaveLength(length - 2);
  });

  it('rejects lists outside the 2 to 27 location limit', () => {
    expect(() => normalizePublicRouteRequest(publicRequest([]))).toThrow(
      'locations must contain between 2 and 27 items',
    );
    expect(() =>
      normalizePublicRouteRequest(
        publicRequest(
          Array.from({ length: 28 }, (_, index) => ({ placeId: `${index}` })),
        ),
      ),
    ).toThrow('locations must contain between 2 and 27 items');
  });

  it('validates mode, locations, and a timezone-aware departureTime', () => {
    expect(() =>
      normalizePublicRouteRequest({ mode: 'TRANSIT', departureTime }),
    ).toThrow('locations must be an array');
    expect(() =>
      normalizePublicRouteRequest({
        ...publicRequest([{ placeId: 'A' }, { placeId: 'B' }]),
        mode: 'FLYING',
      }),
    ).toThrow('mode must be one of');
    expect(() =>
      normalizePublicRouteRequest({
        ...publicRequest([{ placeId: 'A' }, { placeId: 'B' }]),
        departureTime: '2026-10-02T14:23:00',
      }),
    ).toThrow('timezone offset');
    expect(() =>
      normalizePublicRouteRequest({
        ...publicRequest([{ placeId: 'A' }, { placeId: 'B' }]),
        departureTime: '2026-02-31T14:23:00+09:00',
      }),
    ).toThrow('timezone offset');
    expect(() =>
      normalizePublicRouteRequest(
        publicRequest([{ placeId: '' }, { placeId: 'B' }]),
      ),
    ).toThrow('locations[0]');
  });

  it('keeps the legacy origin/destination contract compatible', () => {
    expect(
      normalizeRouteRequest({
        origin: { address: 'A' },
        intermediates: [{ placeId: 'B' }],
        destination: { latitude: 35, longitude: 139 },
        travelMode: 'walking',
      }),
    ).toMatchObject({
      origin: { type: 'address', address: 'A' },
      intermediates: [{ type: 'placeId', placeId: 'B' }],
      destination: { type: 'coordinates', latitude: 35, longitude: 139 },
      travelMode: 'WALKING',
    });
  });
});

describe('public route temporal metadata and cache keys', () => {
  it.each([
    ['2026-10-02T14:23:00+09:00', 'weekday'],
    ['2026-10-03T14:29:00+09:00', 'saturday'],
    ['2026-10-04T14:30:00+09:00', 'sunday'],
  ] as const)('calculates %s as %s in ten-minute buckets', (time, dayType) => {
    const normalized = normalizePublicRouteRequest({
      locations: [{ placeId: 'A' }, { placeId: 'B' }],
      mode: 'TRANSIT',
      departureTime: time,
    });

    expect(
      getRouteTemporalMetadata(normalized, { timeZone: 'Asia/Tokyo' }),
    ).toEqual({
      dayType,
      timeBucket: time.includes('14:30') ? '14:30' : '14:20',
    });
  });

  it('canonicalizes locations and includes their full order in the cache key', () => {
    const first = normalizePublicRouteRequest(
      publicRequest([
        { placeId: 'A' },
        { latitude: 35.6812361, longitude: 139.7671259 },
        { address: '  Tokyo   Station  ' },
      ]),
    );
    const same = normalizePublicRouteRequest(
      publicRequest([
        { placeId: 'A' },
        { latitude: 35.6812362, longitude: 139.7671258 },
        { address: 'Tokyo Station' },
      ]),
    );
    const reordered = normalizePublicRouteRequest(
      publicRequest([
        { placeId: 'A' },
        { address: 'Tokyo Station' },
        { latitude: 35.6812362, longitude: 139.7671258 },
      ]),
    );
    const options = { timeZone: 'Asia/Tokyo' };

    expect(ROUTE_COORDINATE_PRECISION).toBe(5);
    expect(canonicalizeRouteLocation(first.intermediates[0]!)).toBe(
      'coord:35.68124,139.76713',
    );
    expect(createRouteCacheKey(first, 'google', options)).toBe(
      createRouteCacheKey(same, 'google', options),
    );
    expect(createRouteCacheKey(first, 'google', options)).not.toBe(
      createRouteCacheKey(reordered, 'google', options),
    );
  });
});
