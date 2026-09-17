import type { RouteBounds, RouteCoordinate } from './types.js';

export function decodeGooglePolyline(encoded: string): RouteCoordinate[] {
  const path: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latitudeValue = decodeValue(encoded, index);
    index = latitudeValue.index;
    const longitudeValue = decodeValue(encoded, index);
    index = longitudeValue.index;
    latitude += latitudeValue.delta;
    longitude += longitudeValue.delta;
    path.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }

  return path;
}

export function encodeGooglePolyline(path: RouteCoordinate[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = '';

  for (const point of path) {
    const latitude = Math.round(point.lat * 1e5);
    const longitude = Math.round(point.lng * 1e5);
    encoded += encodeValue(latitude - previousLatitude);
    encoded += encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

function encodeValue(delta: number) {
  let value = delta < 0 ? ~(delta << 1) : delta << 1;
  let encoded = '';
  while (value >= 0x20) {
    encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  return encoded + String.fromCharCode(value + 63);
}

function decodeValue(encoded: string, start: number) {
  let index = start;
  let result = 0;
  let shift = 0;
  let byte: number;

  do {
    if (index >= encoded.length) {
      throw new Error('Invalid encoded Google polyline');
    }
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    index,
    delta: result & 1 ? ~(result >> 1) : result >> 1,
  };
}

export function boundsFromPath(path: RouteCoordinate[]): RouteBounds | null {
  if (!path.length) return null;
  const first = path[0]!;
  return path.reduce<RouteBounds>(
    (bounds, point) => ({
      north: Math.max(bounds.north, point.lat),
      south: Math.min(bounds.south, point.lat),
      east: Math.max(bounds.east, point.lng),
      west: Math.min(bounds.west, point.lng),
    }),
    {
      north: first.lat,
      south: first.lat,
      east: first.lng,
      west: first.lng,
    },
  );
}
