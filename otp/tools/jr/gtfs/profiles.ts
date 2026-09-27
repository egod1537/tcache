import type { GtfsGeneratorConfig } from './model.js';
import { GTFS_GENERATOR_VERSION } from './model.js';
import type { NormalizedTimetable } from '../common/index.js';

/**
 * Feed-local circular-line policy:
 *   0 = outer loop (外回り, clockwise)
 *   1 = inner loop (内回り, counter-clockwise)
 */
export const JR_EAST_YAMANOTE_GTFS_CONFIG: GtfsGeneratorConfig = {
  generatorVersion: GTFS_GENERATOR_VERSION,
  agencies: {
    'jr-east': {
      agencyId: 'jr-east',
      agencyName: '東日本旅客鉄道',
      agencyUrl: 'https://www.jreast.co.jp/',
      agencyTimezone: 'Asia/Tokyo',
      agencyLang: 'ja',
    },
  },
  routes: {
    'jr-east:yamanote': {
      routeType: 2,
      routeShortName: 'JY',
      routeLongName: '山手線',
    },
  },
  directionIds: { outer: 0, inner: 1 },
  directionLabels: { outer: '外回り', inner: '内回り' },
  feed: {
    publisherName: 'tcache Tokyo OTP Personal Research PoC',
    publisherUrl: 'https://timetables.jreast.co.jp/',
    language: 'ja',
  },
};

export const JR_EAST_EXPANDED_GTFS_CONFIG: GtfsGeneratorConfig = {
  ...JR_EAST_YAMANOTE_GTFS_CONFIG,
  routes: {
    ...JR_EAST_YAMANOTE_GTFS_CONFIG.routes,
    'jr-east:chuo-rapid': {
      routeType: 2,
      routeShortName: 'JC',
      routeLongName: '中央線快速',
    },
    'jr-east:chuo-sobu-local': {
      routeType: 2,
      routeShortName: 'JB',
      routeLongName: '中央・総武線各駅停車',
    },
    'jr-east:keihin-tohoku': {
      routeType: 2,
      routeShortName: 'JK',
      routeLongName: '京浜東北線・根岸線',
    },
  },
  directionIds: {
    ...JR_EAST_YAMANOTE_GTFS_CONFIG.directionIds,
    westbound: 0,
    eastbound: 1,
    southbound: 0,
    northbound: 1,
  },
  directionLabels: {
    ...JR_EAST_YAMANOTE_GTFS_CONFIG.directionLabels,
    westbound: '西行',
    eastbound: '東行',
    southbound: '南行',
    northbound: '北行',
  },
};

export function createPrivateRailwayGtfsConfig(
  dataset: NormalizedTimetable,
): GtfsGeneratorConfig {
  if (dataset.operators.length !== 1) {
    throw new Error('A private railway feed must contain exactly one operator');
  }
  const operator = dataset.operators[0]!;
  const operatorWebsites: Record<string, string> = {
    tokyu: 'https://www.tokyu.co.jp/railway/',
    odakyu: 'https://www.odakyu.jp/',
    keikyu: 'https://www.keikyu.co.jp/',
    seibu: 'https://www.seiburailway.jp/',
  };
  const website = operatorWebsites[operator.id];
  if (!website) throw new Error(`Unsupported private operator ${operator.id}`);
  const routeShortNames: Record<string, string> = {
    'tokyu:toyoko': 'TY',
    'tokyu:denentoshi': 'DT',
    'tokyu:meguro': 'MG',
    'tokyu:oimachi': 'OM',
    'tokyu:ikegami': 'IK',
    'tokyu:tokyutamagawa': 'TM',
    'tokyu:setagaya': 'SG',
    'odakyu:odawara': 'OH',
    'odakyu:enoshima': 'OE',
    'odakyu:tama': 'OT',
    'keikyu:main': 'KK',
    'keikyu:airport': 'KK',
    'seibu:ikebukuro': 'SI',
    'seibu:shinjuku': 'SS',
  };
  return {
    generatorVersion: GTFS_GENERATOR_VERSION,
    agencies: {
      [operator.id]: {
        agencyId: operator.id,
        agencyName: operator.nameJa,
        agencyUrl: website,
        agencyTimezone: 'Asia/Tokyo',
        agencyLang: 'ja',
      },
    },
    routes: Object.fromEntries(
      dataset.lines.map((line) => [
        line.id,
        {
          routeType: 2,
          ...(routeShortNames[line.id]
            ? { routeShortName: routeShortNames[line.id] }
            : {}),
          routeLongName: line.nameJa,
        },
      ]),
    ),
    directionIds: { ascending: 0, descending: 1 },
    directionLabels: { ascending: '駅順方向', descending: '逆駅順方向' },
    feed: {
      publisherName: 'tcache Tokyo OTP Personal Research PoC',
      publisherUrl: website,
      language: 'ja',
    },
  };
}
