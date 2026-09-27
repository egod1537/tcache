import { readFile } from 'node:fs/promises';

import { strFromU8, unzipSync } from 'fflate';

export const FEEDS = [
  {
    feedId: 'jp-tokyo-jr-east',
    file: 'jr-east.gtfs.zip',
    fallbackFiles: ['jr-east-yamanote.gtfs.zip'],
    operator: 'JR East',
  },
  {
    feedId: 'jp-tokyo-toei-rail',
    file: 'toei-train-gtfs.zip',
    operator: 'Tokyo Metropolitan Bureau of Transportation',
  },
  {
    feedId: 'jp-tokyo-toei-bus',
    file: 'toei-bus-gtfs.zip',
    operator: 'Tokyo Metropolitan Bureau of Transportation',
  },
  {
    feedId: 'jp-tokyo-metro',
    file: 'tokyo-metro.gtfs.zip',
    operator: 'Tokyo Metro Co., Ltd.',
  },
];

export async function loadGtfsFeeds(buildRoot) {
  const feeds = [];
  for (const definition of FEEDS) {
    const candidates = [definition.file, ...(definition.fallbackFiles ?? [])];
    let input;
    let resolvedFile;
    for (const file of candidates) {
      try {
        input = await readFile(`${buildRoot}/inputs/${file}`);
        resolvedFile = file;
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    if (!input || !resolvedFile) {
      throw new Error(`Missing GTFS input; tried ${candidates.join(', ')}.`);
    }
    const archive = unzipSync(new Uint8Array(input));
    const readCsv = (name, required = true) => {
      const value = archive[name];
      if (!value) {
        if (required) throw new Error(`${resolvedFile} has no ${name}.`);
        return [];
      }
      return parseCsv(strFromU8(value));
    };
    const stops = readCsv('stops.txt');
    const routes = readCsv('routes.txt');
    const trips = readCsv('trips.txt');
    const stopTimes = readCsv('stop_times.txt');
    const routeById = new Map(routes.map((route) => [route.route_id, route]));
    const tripRoute = new Map(
      trips.map((trip) => [trip.trip_id, routeById.get(trip.route_id)]),
    );
    const routeTypesByStop = new Map();
    for (const stopTime of stopTimes) {
      const route = tripRoute.get(stopTime.trip_id);
      if (!route) continue;
      const types = routeTypesByStop.get(stopTime.stop_id) ?? new Set();
      types.add(Number(route.route_type));
      routeTypesByStop.set(stopTime.stop_id, types);
    }
    const childrenByParent = new Map();
    for (const stop of stops) {
      if (!stop.parent_station) continue;
      const children = childrenByParent.get(stop.parent_station) ?? [];
      children.push(stop.stop_id);
      childrenByParent.set(stop.parent_station, children);
    }
    feeds.push({
      ...definition,
      file: resolvedFile,
      stops,
      routes,
      trips,
      stopTimes,
      stopById: new Map(stops.map((stop) => [stop.stop_id, stop])),
      childrenByParent,
      routeTypesByStop,
    });
  }
  return feeds;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers = [], ...values] = rows;
  return values.map((valuesRow) =>
    Object.fromEntries(
      headers.map((header, index) => [header, valuesRow[index] ?? '']),
    ),
  );
}

export function normalizeStationName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/(?:jr|ＪＲ|都営|地下鉄)/giu, '')
    .replaceAll(/[\s・･\-‐‑‒–—―_()（）]/gu, '')
    .replace(/駅前$/u, '')
    .replace(/駅$/u, '');
}

export function modeFor(routeTypes, feedId) {
  const types = [...(routeTypes ?? [])];
  if (types.includes(3) || feedId.endsWith('-bus')) return 'BUS';
  if (types.includes(0)) return 'TRAM';
  if (types.includes(1)) return 'SUBWAY';
  if (types.includes(2)) return 'RAIL';
  return feedId.endsWith('-rail') ? 'RAIL' : 'UNKNOWN';
}

export function haversineMeters(left, right) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(Number(left.lat));
  const lat2 = radians(Number(right.lat));
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(Number(right.lon) - Number(left.lon));
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scopedId(feedId, stopId) {
  return `${feedId}:${stopId}`;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
