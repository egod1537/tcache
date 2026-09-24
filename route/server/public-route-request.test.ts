import { describe, expect, it } from 'vitest';

import {
  canonicalizeRouteLocation,
  DEFAULT_ROUTE_TIME_BUCKET_MINUTES,
  getTimeBucketPolicy,
  getRouteTemporalMetadata,
  resolveRouteTimeZone,
  ROUTE_COORDINATE_PRECISION,
} from './cache/canonical.js';
import { createRouteCacheKey } from './cache/key.js';
import { validateRouteRequestForProvider } from './providers/location-validation.js';
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
      origin: { externalIds: { googlePlaceId: 'A' } },
      intermediates: [{ address: '東京駅、日本' }],
      destination: {
        coordinates: { latitude: 35.6812, longitude: 139.7671 },
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
      origin: { address: 'A' },
      intermediates: [{ externalIds: { googlePlaceId: 'B' } }],
      destination: { coordinates: { latitude: 35, longitude: 139 } },
      travelMode: 'WALKING',
    });
  });

  it('normalizes countryCode and provider override metadata', () => {
    expect(
      normalizePublicRouteRequest({
        ...publicRequest([{ address: 'Tokyo' }, { address: 'Kyoto' }]),
        countryCode: 'jp',
        provider: 'NAVITIME',
      }),
    ).toMatchObject({ countryCode: 'JP', provider: 'navitime' });
    expect(() =>
      normalizePublicRouteRequest({
        ...publicRequest([{ address: 'Tokyo' }, { address: 'Kyoto' }]),
        countryCode: 'JPN',
      }),
    ).toThrow('countryCode must be an ISO 3166-1 alpha-2 code');
  });

  it('preserves Ekispert station IDs independently from Google IDs', () => {
    const normalized = normalizePublicRouteRequest({
      ...publicRequest([
        {
          externalIds: {
            googlePlaceId: 'google-origin',
            ekispertId: '22828',
          },
        },
        { externalIds: { ekispertId: '22715' } },
      ]),
      countryCode: 'JP',
      provider: 'ekispert',
    });
    expect(normalized).toMatchObject({
      provider: 'ekispert',
      origin: {
        externalIds: {
          googlePlaceId: 'google-origin',
          ekispertId: '22828',
        },
      },
      destination: { externalIds: { ekispertId: '22715' } },
    });
    expect(canonicalizeRouteLocation(normalized.origin, 'ekispert')).toBe(
      'external:ekispert:22828',
    );
  });

  it('validates and preserves an explicit IANA timezone', () => {
    expect(
      normalizePublicRouteRequest({
        ...publicRequest([{ address: 'Tokyo' }, { address: 'Kyoto' }]),
        timeZone: 'Asia/Tokyo',
      }),
    ).toMatchObject({ timeZone: 'Asia/Tokyo' });
    expect(() =>
      normalizePublicRouteRequest({
        ...publicRequest([{ address: 'Tokyo' }, { address: 'Kyoto' }]),
        timeZone: 'Mars/Olympus',
      }),
    ).toThrow('valid IANA timezone');
  });

  it('preserves coordinates with a Google Place ID', () => {
    const normalized = normalizeRouteRequest({
      origin: {
        placeId: 'legacy-google-id',
        latitude: 35.1,
        longitude: 139.1,
      },
      destination: { address: 'Tokyo' },
      travelMode: 'DRIVING',
    });

    expect(normalized.origin).toEqual({
      coordinates: { latitude: 35.1, longitude: 139.1 },
      externalIds: { googlePlaceId: 'legacy-google-id' },
    });
  });

  it.each([
    [{ latitude: 35 }, 'both latitude and longitude'],
    [{ longitude: 139 }, 'both latitude and longitude'],
    [{ latitude: 91, longitude: 139 }, 'between -90 and 90'],
    [{ latitude: 35, longitude: 181 }, 'between -180 and 180'],
  ])('rejects invalid coordinates %#', (origin, message) => {
    expect(() =>
      normalizeRouteRequest({
        origin,
        destination: { address: 'Tokyo' },
        travelMode: 'DRIVING',
      }),
    ).toThrow(message);
  });

  it('does not pass a Google Place ID to Kakao', () => {
    const normalized = normalizeRouteRequest({
      origin: { placeId: 'google-only' },
      destination: { coordinates: { latitude: 35, longitude: 139 } },
      travelMode: 'DRIVING',
    });

    expect(() => validateRouteRequestForProvider(normalized, 'kakao')).toThrow(
      'origin cannot be used with kakao: coordinates are required',
    );
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

  it('keeps an explicit provider-aware ten-minute transit bucket policy', () => {
    expect(DEFAULT_ROUTE_TIME_BUCKET_MINUTES).toBe(10);
    expect(getTimeBucketPolicy('TRANSIT', 'navitime')).toEqual({ minutes: 10 });
    const beforeBoundary = normalizePublicRouteRequest({
      locations: [
        { latitude: 35.68, longitude: 139.76 },
        { latitude: 35.65, longitude: 139.7 },
      ],
      mode: 'TRANSIT',
      countryCode: 'JP',
      departureTime: '2026-10-02T14:29:59+09:00',
    });
    const atBoundary = normalizePublicRouteRequest({
      ...publicRequest([
        { latitude: 35.68, longitude: 139.76 },
        { latitude: 35.65, longitude: 139.7 },
      ]),
      countryCode: 'JP',
      departureTime: '2026-10-02T14:30:00+09:00',
    });
    expect(getRouteTemporalMetadata(beforeBoundary).timeBucket).toBe('14:20');
    expect(getRouteTemporalMetadata(atBoundary).timeBucket).toBe('14:30');
  });

  it('uses explicit or country timezones before the global fallback', () => {
    const jp = normalizePublicRouteRequest({
      ...publicRequest([{ address: 'Tokyo' }, { address: 'Kyoto' }]),
      countryCode: 'JP',
      departureTime: '2026-10-02T15:05:00Z',
    });
    const kr = normalizePublicRouteRequest({
      ...publicRequest([{ address: 'Seoul' }, { address: 'Busan' }]),
      countryCode: 'KR',
      departureTime: '2026-10-02T15:05:00Z',
    });
    const explicit = { ...jp, timeZone: 'America/Los_Angeles' };

    expect(resolveRouteTimeZone(jp, 'UTC')).toBe('Asia/Tokyo');
    expect(resolveRouteTimeZone(kr, 'UTC')).toBe('Asia/Seoul');
    expect(resolveRouteTimeZone(explicit, 'UTC')).toBe('America/Los_Angeles');
    expect(
      getRouteTemporalMetadata(jp, { timeZone: 'America/Los_Angeles' }),
    ).toEqual({ dayType: 'saturday', timeBucket: '00:00' });
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
    expect(createRouteCacheKey(first, 'google', options)).toMatch(
      /^route:v4:google:transit:unknown:[a-f0-9]{64}$/,
    );
  });

  it('uses coordinates before external IDs when creating canonical keys', () => {
    const first = normalizePublicRouteRequest(
      publicRequest([
        {
          coordinates: { latitude: 35.6812361, longitude: 139.7671259 },
          externalIds: { googlePlaceId: 'google-a' },
        },
        { address: 'Tokyo' },
      ]),
    );
    const sameCoordinates = normalizePublicRouteRequest(
      publicRequest([
        {
          coordinates: { latitude: 35.6812362, longitude: 139.7671258 },
          externalIds: { googlePlaceId: 'google-b', kakaoPlaceId: 'kakao-b' },
        },
        { address: 'Tokyo' },
      ]),
    );

    expect(canonicalizeRouteLocation(first.origin)).toBe(
      'coord:35.68124,139.76713',
    );
    expect(createRouteCacheKey(first, 'google')).toBe(
      createRouteCacheKey(sameCoordinates, 'google'),
    );
  });

  it('uses the selected provider ID when coordinates are unavailable', () => {
    const first = normalizePublicRouteRequest(
      publicRequest([
        {
          externalIds: {
            googlePlaceId: 'google-a',
            kakaoPlaceId: 'kakao-same',
          },
        },
        { coordinates: { latitude: 35, longitude: 139 } },
      ]),
    );
    const changedGoogleId = normalizePublicRouteRequest(
      publicRequest([
        {
          externalIds: {
            googlePlaceId: 'google-b',
            kakaoPlaceId: 'kakao-same',
          },
        },
        { coordinates: { latitude: 35, longitude: 139 } },
      ]),
    );

    expect(createRouteCacheKey(first, 'kakao-maps')).toBe(
      createRouteCacheKey(changedGoogleId, 'kakao-maps'),
    );
    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(changedGoogleId, 'google'),
    );
  });

  it('isolates providers, modes, and countries in v4 keys', () => {
    const base = {
      locations: [
        { latitude: 35.6812, longitude: 139.7671 },
        { latitude: 35.658, longitude: 139.7016 },
      ],
      departureTime,
      countryCode: 'JP',
    };
    const transit = normalizePublicRouteRequest({ ...base, mode: 'TRANSIT' });
    const driving = normalizePublicRouteRequest({ ...base, mode: 'DRIVING' });
    const korea = normalizePublicRouteRequest({
      ...base,
      mode: 'TRANSIT',
      countryCode: 'KR',
    });

    const google = createRouteCacheKey(transit, 'google');
    const kakao = createRouteCacheKey(transit, 'kakao-maps');
    expect(google).not.toBe(kakao);
    expect(google).toMatch(/^route:v4:google:transit:jp:/);
    expect(kakao).toMatch(/^route:v4:kakao-maps:transit:jp:/);
    expect(createRouteCacheKey(driving, 'google')).not.toBe(google);
    expect(createRouteCacheKey(korea, 'google')).not.toBe(google);
    expect(createRouteCacheKey(transit, 'google')).toBe(google);
    expect(google).not.toContain('route:v3');
  });

  it('normalizes address whitespace, width, and case', () => {
    const first = normalizePublicRouteRequest(
      publicRequest([
        { address: 'ＴＯＫＹＯ   Station' },
        { address: 'Shibuya' },
      ]),
    );
    const same = normalizePublicRouteRequest(
      publicRequest([{ address: 'tokyo station' }, { address: '  shibuya ' }]),
    );
    expect(canonicalizeRouteLocation(first.origin, 'google')).toBe(
      'address:tokyo station',
    );
    expect(createRouteCacheKey(first, 'google')).toBe(
      createRouteCacheKey(same, 'google'),
    );
  });

  it('includes result-affecting route options in the key', () => {
    const first = normalizePublicRouteRequest({
      ...publicRequest([{ address: 'Tokyo' }, { address: 'Shibuya' }]),
      options: { avoidTolls: true },
    });
    const changed = normalizePublicRouteRequest({
      ...publicRequest([{ address: 'Tokyo' }, { address: 'Shibuya' }]),
      options: { avoidTolls: false },
    });
    expect(createRouteCacheKey(first, 'google')).not.toBe(
      createRouteCacheKey(changed, 'google'),
    );
  });
});
