import { describe, expect, it } from 'vitest';
import {
  SchemaParseError,
  parseStationMapping,
  validateStationMapping,
  type StationMapping,
} from '../common/index.js';

describe('station mapping', () => {
  it('accepts a manually reviewed mapping', () => {
    const mapping = parseStationMapping({
      internalStationId: 'jr-east:tokyo',
      operator: 'jr-east',
      officialNameJa: '東京',
      officialNameEn: 'Tokyo',
      sourceStationKey: '123',
      stationNumber: 'JY01',
      osmElementType: 'relation',
      osmElementId: 123456,
      latitude: 35.681236,
      longitude: 139.767125,
      mappingStatus: 'confirmed',
      reviewedAt: '2026-09-27T12:00:00+09:00',
    });

    expect(mapping.mappingStatus).toBe('confirmed');
  });

  it('does not allow similarity output to become confirmed without review', () => {
    const mapping: StationMapping = {
      internalStationId: 'jr-east:tokyo',
      operator: 'jr-east',
      officialNameJa: '東京',
      mappingStatus: 'confirmed',
    };

    expect(
      validateStationMapping(mapping).map((issue) => issue.code),
    ).toContain('MANUAL_REVIEW_REQUIRED');
    expect(() => parseStationMapping(mapping)).toThrow(SchemaParseError);
  });

  it('requires coordinate and OSM identity pairs', () => {
    const mapping: StationMapping = {
      internalStationId: 'jr-east:tokyo',
      operator: 'jr-east',
      officialNameJa: '東京',
      latitude: 35.681236,
      osmElementType: 'relation',
      mappingStatus: 'candidate',
    };

    const codes = validateStationMapping(mapping).map((issue) => issue.code);
    expect(codes).toContain('COORDINATE_PAIR');
    expect(codes).toContain('OSM_ELEMENT_PAIR');
  });
});
