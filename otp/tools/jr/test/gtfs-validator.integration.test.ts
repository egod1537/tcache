import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { StationMappingSet } from '../common/index.js';
import {
  buildGtfs,
  runMobilityDataValidator,
  type GtfsGeneratorConfig,
} from '../gtfs/index.js';
import { makeValidDataset } from './fixtures.js';

const runIntegration = process.env.RUN_MOBILITYDATA_VALIDATOR === '1';
const roots: string[] = [];

describe.runIf(runIntegration)(
  'GTFS ZIP official validator integration',
  () => {
    afterAll(async () => {
      await Promise.all(
        roots.map((path) => rm(path, { recursive: true, force: true })),
      );
    });

    it('builds a normalized fixture ZIP with MobilityData ERROR 0', async () => {
      const root = await mkdtemp(join(process.cwd(), 'tmp-gtfs-validator-'));
      roots.push(root);
      const dataset = makeValidDataset();
      const mappings: StationMappingSet = {
        schemaVersion: '1.0',
        operator: 'jr-east',
        reviewMethod: 'Exact synthetic fixture IDs.',
        source: {
          name: 'Synthetic integration fixture',
          url: 'https://example.com/osm-fixture',
          retrievedAt: '2026-09-27T00:00:00.000Z',
        },
        mappings: dataset.stations.map((station, index) => ({
          internalStationId: station.id,
          operator: station.operatorId,
          officialNameJa: station.nameJa,
          latitude: 35.68 + index * 0.01,
          longitude: 139.76 + index * 0.01,
          mappingStatus: 'confirmed',
          reviewedAt: '2026-09-27T00:00:00.000Z',
        })),
      };
      const config: GtfsGeneratorConfig = {
        generatorVersion: 'integration-fixture/1.0.0',
        agencies: {
          'jr-east': {
            agencyId: 'jr-east',
            agencyName: 'JR East fixture',
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
          publisherName: 'tcache integration fixture',
          publisherUrl: 'https://example.com/',
          language: 'ja',
        },
      };
      const build = await buildGtfs({
        datasetRoot: root,
        dataset,
        stationMappingSet: mappings,
        config,
        zipName: 'fixture.gtfs.zip',
      });
      const validator = await runMobilityDataValidator({
        datasetRoot: root,
        zipPath: build.zipPath,
        outputDirectory: join(root, 'validator'),
        validatorVersion: '8.0.1',
      });

      expect(validator.errorCount).toBe(0);
    }, 120_000);
  },
);
