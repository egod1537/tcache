import { describe, expect, it } from 'vitest';

import { MATRIX_PRESETS, getMatrixPreset } from './matrix-presets.js';
import {
  buildMatrixRequest,
  buildTrouteRequestPreview,
  createMatrixDraft,
} from './matrix-types.js';

describe('real Place ID matrix presets', () => {
  it('provides Tokyo and Seoul 3/5/10 presets from generated fixture data', () => {
    expect(MATRIX_PRESETS.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'tokyo-3',
        'tokyo-5',
        'tokyo-10',
        'seoul-3',
        'seoul-5',
        'seoul-10',
      ]),
    );

    for (const city of ['tokyo', 'seoul']) {
      const complete = getMatrixPreset(`${city}-10`).locations;
      for (const size of [3, 5, 10]) {
        const preset = getMatrixPreset(`${city}-${size}`);
        expect(preset.locations).toHaveLength(size);
        expect(preset.locations).toEqual(complete.slice(0, size));
        expect(
          preset.locations.every(
            ({ name, location }) =>
              Boolean(name) &&
              location.type === 'placeId' &&
              location.placeId.length > 0,
          ),
        ).toBe(true);
      }
    }
  });

  it('builds tcache and troute contracts from the same ordered Place IDs', () => {
    const matrixRequest = buildMatrixRequest(createMatrixDraft('tokyo-3'));
    const trouteRequest = buildTrouteRequestPreview(matrixRequest);

    expect(matrixRequest.locations).toHaveLength(3);
    expect(matrixRequest.locations[0]).toEqual({
      id: 'tokyo-station',
      placeId: 'ChIJC3Cf2PuLGGAROO00ukl8JwA',
    });
    expect(trouteRequest?.locations[0]).toMatchObject({
      id: 'tokyo-station',
      place_id: 'ChIJC3Cf2PuLGGAROO00ukl8JwA',
    });
    expect(trouteRequest?.start_time).toBe('09:00');
  });
});
