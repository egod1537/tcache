import { describe, expect, it } from 'vitest';
import {
  SchemaParseError,
  parseNormalizedTimetable,
  parseStationMappingSet,
} from '../common/index.js';
import { makeValidDataset } from './fixtures.js';

describe('normalized timetable schema', () => {
  it('parses a structurally and semantically valid document', () => {
    const input: unknown = JSON.parse(JSON.stringify(makeValidDataset()));
    const parsed = parseNormalizedTimetable(input);

    expect(parsed.trips[0]?.stopTimes[1]?.arrival).toEqual({
      dayOffset: 1,
      hour: 0,
      minute: 1,
      second: 0,
    });
  });

  it('rejects string times at the normalized boundary', () => {
    const input = structuredClone(makeValidDataset()) as unknown as {
      trips: Array<{ stopTimes: Array<{ departure?: unknown }> }>;
    };
    input.trips[0]!.stopTimes[0]!.departure = '23:58';

    expect(() => parseNormalizedTimetable(input)).toThrow(SchemaParseError);
  });
});

describe('station mapping set schema', () => {
  it('requires reviewed, valid mappings with matching operators', () => {
    const mappingSet = {
      schemaVersion: '1.0',
      operator: 'jr-east',
      reviewMethod: 'Exact ID fixture review.',
      source: {
        name: 'OSM fixture',
        url: 'https://www.openstreetmap.org/relation/1972920',
        retrievedAt: '2026-09-27T00:00:00.000Z',
        routeRelationIds: [1972920],
      },
      mappings: [
        {
          internalStationId: 'jr-east:tokyo',
          operator: 'jr-east',
          officialNameJa: '東京',
          latitude: 35.681244,
          longitude: 139.7666095,
          mappingStatus: 'confirmed',
          reviewedAt: '2026-09-27T00:00:00.000Z',
        },
      ],
    };

    expect(parseStationMappingSet(mappingSet).mappings).toHaveLength(1);
    mappingSet.mappings[0]!.operator = 'jr-west';
    expect(() => parseStationMappingSet(mappingSet)).toThrow(SchemaParseError);
  });
});
