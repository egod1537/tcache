import { describe, expect, it } from 'vitest';
import { summarizeNotices } from '../gtfs/index.js';

describe('MobilityData validator report parsing', () => {
  it('summarizes notice groups without counting nested samples twice', () => {
    const report = {
      notices: [
        { code: 'missing_shape', severity: 'WARNING', totalNotices: 3 },
        { code: 'invalid_time', severity: 'ERROR', totalNotices: 1 },
      ],
    };

    expect(summarizeNotices(report)).toEqual([
      { code: 'missing_shape', severity: 'WARNING', count: 3 },
      { code: 'invalid_time', severity: 'ERROR', count: 1 },
    ]);
  });
});
