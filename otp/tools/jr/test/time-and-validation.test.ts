import { describe, expect, it } from 'vitest';
import {
  formatServiceDayTime,
  parseServiceDayTime,
  validateNormalizedTimetable,
} from '../common/index.js';
import { makeValidDataset } from './fixtures.js';

describe('service-day time', () => {
  it('round-trips after-midnight values without using a string in the model', () => {
    const time = parseServiceDayTime('25:07:09');
    expect(time).toEqual({ dayOffset: 1, hour: 1, minute: 7, second: 9 });
    expect(formatServiceDayTime(time)).toBe('25:07:09');
  });

  it('rejects malformed clock values', () => {
    expect(() => parseServiceDayTime('24:60')).toThrow(
      'Invalid service-day time',
    );
  });
});

describe('normalized timetable validation', () => {
  it('detects duplicate/out-of-order sequences and time regression', () => {
    const dataset = makeValidDataset();
    dataset.trips[0]!.stopTimes[1]!.sequence = 0;
    dataset.trips[0]!.stopTimes[1]!.arrival = parseServiceDayTime('22:00');

    const codes = validateNormalizedTimetable(dataset).map(
      (issue) => issue.code,
    );
    expect(codes).toContain('DUPLICATE_SEQUENCE');
    expect(codes).toContain('SEQUENCE_ORDER');
    expect(codes).toContain('TIME_REGRESSION');
  });

  it('detects missing references, minimum stops, and trip ID collisions', () => {
    const dataset = makeValidDataset();
    const duplicate = structuredClone(dataset.trips[0]!);
    duplicate.lineId = 'jr-east:missing-line';
    duplicate.stopTimes = duplicate.stopTimes.slice(0, 1);
    duplicate.destinationStationId = 'jr-east:missing-station';
    dataset.trips.push(duplicate);

    const codes = validateNormalizedTimetable(dataset).map(
      (issue) => issue.code,
    );
    expect(codes).toContain('TRIP_ID_COLLISION');
    expect(codes).toContain('REFERENCE');
    expect(codes).toContain('MIN_STOPS');
  });
});
