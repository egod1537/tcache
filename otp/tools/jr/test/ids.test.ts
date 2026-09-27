import { describe, expect, it } from 'vitest';
import {
  createStationId,
  createTripId,
  parseServiceDayTime,
} from '../common/index.js';

describe('deterministic IDs', () => {
  it('normalizes semantic station keys deterministically', () => {
    expect(createStationId('JR East', ' 東京 Station ')).toBe(
      'jr-east:東京-station',
    );
    expect(createStationId('ＪＲ EAST', '東京　Station')).toBe(
      'jr-east:東京-station',
    );
  });

  it('rejects a numeric upstream URL key as a persistent station ID', () => {
    expect(() => createStationId('jr-east', '12345')).toThrow(
      'numeric upstream key',
    );
  });

  it('builds a stable trip ID from the documented identity fields', () => {
    const parts = {
      operator: 'jr-east',
      edition: '2026-09',
      line: 'yamanote',
      direction: 'clockwise',
      trainNumber: '2301G',
      origin: 'tokyo',
      firstDeparture: parseServiceDayTime('25:02'),
      variant: 'weekday-a',
    };

    expect(createTripId(parts)).toBe(createTripId({ ...parts }));
    expect(createTripId(parts)).toContain(':25-02-00:');
  });
});
