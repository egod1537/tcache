import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import type { StationMappingSet } from '../common/index.js';
import {
  GtfsGenerationError,
  buildGtfs,
  generateGtfsFeed,
  type GtfsGeneratorConfig,
} from '../gtfs/index.js';
import { makeValidDataset } from './fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('normalized timetable to GTFS', () => {
  it('maps stations, lines, trips, stop sequence, and weekday calendar', () => {
    const result = generateGtfsFeed(fixtureInput());

    expect(result.files.get('stops.txt')).toContain(
      'jr-east:tokyo,JY01,東京,35.681244,139.7666095,0',
    );
    expect(result.files.get('routes.txt')).toContain(
      'jr-east:yamanote,jr-east,JY,山手線,2',
    );
    expect(result.files.get('trips.txt')).toContain(',2301G,0\n');
    expect(result.files.get('stop_times.txt')).toContain(
      '23:58:00,23:58:00,jr-east:tokyo,1',
    );
    expect(result.files.get('stop_times.txt')).toContain(
      '24:01:00,24:01:00,jr-east:kanda,2',
    );
    expect(result.files.get('calendar.txt')).toContain(
      'jr-east:weekday,1,1,1,1,1,0,0,20260901,20270331',
    );
    expect(result.files.get('calendar_dates.txt')).toBe(
      'service_id,date,exception_type\n',
    );
    expect(result.feedVersion).toContain(
      makeValidDataset().metadata.datasetVersion,
    );
  });

  it('fails instead of inventing a missing coordinate', () => {
    const input = fixtureInput();
    delete input.stationMappingSet.mappings[0]!.latitude;

    expect(() => generateGtfsFeed(input)).toThrow(GtfsGenerationError);
    try {
      generateGtfsFeed(input);
    } catch (error) {
      expect(
        (error as GtfsGenerationError).issues.map((issue) => issue.code),
      ).toContain('MAPPING_COORDINATES_MISSING');
    }
  });

  it('writes a reproducible ZIP and canonical content hash', async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const input = fixtureInput();
    const first = await buildGtfs({
      datasetRoot: firstRoot,
      ...input,
      generatedAt: '2026-09-27T00:00:00.000Z',
      zipName: 'fixture.gtfs.zip',
    });
    const second = await buildGtfs({
      datasetRoot: secondRoot,
      ...fixtureInput(),
      generatedAt: '2026-09-27T00:00:00.000Z',
      zipName: 'fixture.gtfs.zip',
    });

    expect(second.manifest.canonicalContentHash).toBe(
      first.manifest.canonicalContentHash,
    );
    expect(second.manifest.zipSha256).toBe(first.manifest.zipSha256);
    const files = unzipSync(await readFile(first.zipPath));
    expect(Object.keys(files).sort()).toEqual([
      'agency.txt',
      'calendar.txt',
      'calendar_dates.txt',
      'feed_info.txt',
      'routes.txt',
      'stop_times.txt',
      'stops.txt',
      'trips.txt',
    ]);
    expect(strFromU8(files['feed_info.txt']!)).toContain(
      first.manifest.feedVersion,
    );
  });
});

function fixtureInput(): {
  dataset: ReturnType<typeof makeValidDataset>;
  stationMappingSet: StationMappingSet;
  config: GtfsGeneratorConfig;
} {
  const dataset = makeValidDataset();
  return {
    dataset,
    stationMappingSet: {
      schemaVersion: '1.0',
      operator: 'jr-east',
      lineId: 'jr-east:yamanote',
      reviewMethod: 'Fixture mapping reviewed by exact ID.',
      source: {
        name: 'Synthetic fixture',
        url: 'https://example.invalid/osm-fixture',
        retrievedAt: '2026-09-27T00:00:00.000Z',
      },
      mappings: [
        {
          internalStationId: 'jr-east:tokyo',
          operator: 'jr-east',
          officialNameJa: '東京',
          stationNumber: 'JY01',
          latitude: 35.681244,
          longitude: 139.7666095,
          mappingStatus: 'confirmed',
          reviewedAt: '2026-09-27T00:00:00.000Z',
        },
        {
          internalStationId: 'jr-east:kanda',
          operator: 'jr-east',
          officialNameJa: '神田',
          stationNumber: 'JY02',
          latitude: 35.6917689,
          longitude: 139.7710125,
          mappingStatus: 'confirmed',
          reviewedAt: '2026-09-27T00:00:00.000Z',
        },
      ],
    },
    config: {
      generatorVersion: 'fixture-generator/1.0.0',
      agencies: {
        'jr-east': {
          agencyId: 'jr-east',
          agencyName: 'JR East',
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
      directionIds: { clockwise: 0 },
      feed: {
        publisherName: 'tcache test fixture',
        publisherUrl: 'https://example.invalid/',
        language: 'ja',
      },
    },
  };
}

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'tcache-gtfs-test-'));
  temporaryDirectories.push(path);
  return path;
}
