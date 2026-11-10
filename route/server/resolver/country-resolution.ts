import type {
  NormalizedRouteRequest,
  RouteCoordinates,
} from '../types/route.js';

export type CountryResolutionSource = 'explicit' | 'coordinates' | 'none';

export interface CountryResolution {
  countryCode?: string;
  source: CountryResolutionSource;
}

interface CoordinateRegion {
  countryCode: 'JP' | 'KR';
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * Conservative land-area envelopes for the countries with built-in regional
 * provider policies. Every request location must resolve to the same country.
 * regionCode is intentionally excluded because it is a localization hint.
 */
const COORDINATE_REGIONS: readonly CoordinateRegion[] = [
  // South Korea: mainland/southern islands, Jeju, and Ulleungdo.
  {
    countryCode: 'KR',
    minLatitude: 34.7,
    maxLatitude: 38.7,
    minLongitude: 125.5,
    maxLongitude: 129.7,
  },
  {
    countryCode: 'KR',
    minLatitude: 34,
    maxLatitude: 34.7,
    minLongitude: 125.5,
    maxLongitude: 128.8,
  },
  {
    countryCode: 'KR',
    minLatitude: 33,
    maxLatitude: 33.7,
    minLongitude: 126,
    maxLongitude: 127,
  },
  {
    countryCode: 'KR',
    minLatitude: 37.3,
    maxLatitude: 37.6,
    minLongitude: 130.7,
    maxLongitude: 131,
  },
  // Japan: Hokkaido, Honshu, Shikoku, Kyushu/Tsushima, and Okinawa.
  {
    countryCode: 'JP',
    minLatitude: 41.3,
    maxLatitude: 45.7,
    minLongitude: 139.3,
    maxLongitude: 146,
  },
  {
    countryCode: 'JP',
    minLatitude: 34.2,
    maxLatitude: 41.6,
    minLongitude: 130.7,
    maxLongitude: 142.2,
  },
  {
    countryCode: 'JP',
    minLatitude: 32.7,
    maxLatitude: 34.7,
    minLongitude: 132,
    maxLongitude: 135,
  },
  {
    countryCode: 'JP',
    minLatitude: 30.9,
    maxLatitude: 34.7,
    minLongitude: 129,
    maxLongitude: 132.2,
  },
  {
    countryCode: 'JP',
    minLatitude: 24,
    maxLatitude: 30.9,
    minLongitude: 122.9,
    maxLongitude: 131.4,
  },
];

export function resolveRequestCountry(
  request: NormalizedRouteRequest,
): CountryResolution {
  if (request.countryCode) {
    return { countryCode: request.countryCode, source: 'explicit' };
  }

  const locations = [
    request.origin,
    ...request.intermediates,
    request.destination,
  ];
  if (locations.some((location) => !location.coordinates)) {
    return { source: 'none' };
  }

  const countries = new Set(
    locations.map((location) =>
      resolveCoordinateCountry(location.coordinates!),
    ),
  );
  if (countries.size !== 1 || countries.has(undefined)) {
    return { source: 'none' };
  }
  const countryCode = [...countries][0];
  return countryCode
    ? { countryCode, source: 'coordinates' }
    : { source: 'none' };
}

function resolveCoordinateCountry(
  coordinates: RouteCoordinates,
): 'JP' | 'KR' | undefined {
  return COORDINATE_REGIONS.find(
    (region) =>
      coordinates.latitude >= region.minLatitude &&
      coordinates.latitude <= region.maxLatitude &&
      coordinates.longitude >= region.minLongitude &&
      coordinates.longitude <= region.maxLongitude,
  )?.countryCode;
}
