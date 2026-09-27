import type { GtfsGeneratorConfig } from './model.js';
import { GTFS_GENERATOR_VERSION } from './model.js';

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
