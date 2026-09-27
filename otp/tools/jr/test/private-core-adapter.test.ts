import { describe, expect, it } from 'vitest';
import { parseNormalizedTimetable } from '../common/index.js';
import { generateGtfsFeed } from '../gtfs/generator.js';
import { createPrivateRailwayGtfsConfig } from '../gtfs/profiles.js';
import { adaptOdptStationTimetables } from '../private-core/odpt-adapter.js';
import { TOKYU_PRIVATE_CONFIG } from '../private-core/profiles.js';

const HASHES = ['1', '2', '3'].map((value) => value.repeat(64));

function fixture() {
  const stationIds = ['Shibuya', 'Nakameguro', 'Jiyugaoka'];
  return {
    operator: {
      ...TOKYU_PRIVATE_CONFIG,
      lines: [TOKYU_PRIVATE_CONFIG.lines[0]!],
    },
    railways: [
      {
        'owl:sameAs': 'odpt.Railway:Tokyu.Toyoko',
        'odpt:stationOrder': stationIds.map((station, index) => ({
          'odpt:index': index + 1,
          'odpt:station': `odpt.Station:Tokyu.Toyoko.${station}`,
        })),
      },
    ],
    stations: stationIds.map((station, index) => ({
      'owl:sameAs': `odpt.Station:Tokyu.Toyoko.${station}`,
      'odpt:railway': 'odpt.Railway:Tokyu.Toyoko',
      'odpt:stationTitle': {
        ja: ['渋谷', '中目黒', '自由が丘'][index],
        en: station,
      },
      'odpt:stationCode': ['TY01', 'TY03', 'TY07'][index],
      'geo:lat': 35.65 - index * 0.01,
      'geo:long': 139.7 - index * 0.01,
    })),
    stationTimetables: stationIds.map((station, index) => ({
      'odpt:station': `odpt.Station:Tokyu.Toyoko.${station}`,
      'odpt:railway': 'odpt.Railway:Tokyu.Toyoko',
      'odpt:calendar': 'odpt.Calendar:Weekday',
      'odpt:railDirection': 'odpt.RailDirection:Outbound',
      'odpt:stationTimetableObject': [
        {
          'odpt:train': 'odpt.Train:Tokyu.Toyoko.001',
          'odpt:trainNumber': '001',
          'odpt:trainType': 'odpt.TrainType:Tokyu.Local',
          ...(index === 0
            ? { 'odpt:departureTime': '23:58' }
            : index === 2
              ? { 'odpt:arrivalTime': '00:08' }
              : { 'odpt:arrivalTime': '00:03', 'odpt:departureTime': '00:04' }),
        },
      ],
    })),
    sourceArtifactHashes: HASHES,
    sourceUrls: {
      railways: 'https://example.test/railways',
      stations: 'https://example.test/stations',
      stationTimetables: 'https://example.test/timetables',
    },
    sourceEdition: 'challenge-2026-fixture',
    serviceStartDate: '2026-09-01',
    serviceEndDate: '2026-12-31',
    generatedAt: '2026-09-27T00:00:00.000Z',
  };
}

describe('ODPT private railway adapter', () => {
  it('reconstructs a deterministic trip and preserves midnight rollover', () => {
    const first = adaptOdptStationTimetables(fixture());
    const second = adaptOdptStationTimetables(fixture());
    expect(parseNormalizedTimetable(first.dataset)).toEqual(first.dataset);
    expect(first.dataset.metadata.datasetVersion).toBe(
      second.dataset.metadata.datasetVersion,
    );
    expect(first.dataset.trips).toHaveLength(1);
    expect(
      first.dataset.trips[0]?.stopTimes.map((stop) => stop.sequence),
    ).toEqual([1, 2, 3]);
    expect(first.dataset.trips[0]?.stopTimes[1]?.arrival?.dayOffset).toBe(1);
    expect(first.dataset.trips[0]?.stopTimes[2]?.arrival?.dayOffset).toBe(1);
  });

  it('emits unreviewed coordinate candidates and performs no through merge', () => {
    const result = adaptOdptStationTimetables(fixture());
    expect(result.mappingCandidates.mappings).toHaveLength(3);
    expect(
      result.mappingCandidates.mappings.every(
        (mapping) => mapping.mappingStatus === 'candidate',
      ),
    ).toBe(true);
    expect(result.diagnostics.throughServiceMerges).toBe(0);
    expect(result.dataset.trips[0]?.operationConditions).toContain(
      'No cross-line through-service merge was inferred by the adapter.',
    );
  });

  it('fails closed when station order is ambiguous', () => {
    const input = fixture();
    const duplicate =
      input.stationTimetables[0]!['odpt:stationTimetableObject'][0]!;
    input.stationTimetables[0]!['odpt:stationTimetableObject'].push({
      ...duplicate,
    });
    expect(() => adaptOdptStationTimetables(input)).toThrow(
      'No valid trip with two or more stops',
    );
  });

  it('reuses the common GTFS generator only after coordinate review', () => {
    const result = adaptOdptStationTimetables(fixture());
    const config = createPrivateRailwayGtfsConfig(result.dataset);
    expect(() =>
      generateGtfsFeed({
        dataset: result.dataset,
        stationMappingSet: result.mappingCandidates,
        config,
      }),
    ).toThrow();
    const reviewed = {
      ...result.mappingCandidates,
      mappings: result.mappingCandidates.mappings.map((mapping) => ({
        ...mapping,
        mappingStatus: 'confirmed' as const,
        reviewedAt: '2026-09-27T00:00:00.000Z',
      })),
    };
    const gtfs = generateGtfsFeed({
      dataset: result.dataset,
      stationMappingSet: reviewed,
      config,
    });
    expect(gtfs.counts.trips).toBe(1);
    expect(gtfs.files.get('stop_times.txt')).toContain('24:03:00');
  });
});
