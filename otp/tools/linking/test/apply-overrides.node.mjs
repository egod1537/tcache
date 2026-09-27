import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { applyOverrides } from '../apply-overrides.mjs';

test('applies only reviewed high-confidence scoped overrides reproducibly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tcache-linking-'));
  const input = zipSync({
    'stops.txt': strToU8(
      'stop_id,stop_name,stop_lat,stop_lon\r\nA,"Alpha, Station",35.1,139.1\r\n',
    ),
    'agency.txt': strToU8('agency_id,agency_name\r\nA,Agency\r\n'),
  });
  const inputPath = join(root, 'input.zip');
  const overridesPath = join(root, 'overrides.json');
  const outputOne = join(root, 'one.zip');
  const outputTwo = join(root, 'two.zip');
  await writeFile(inputPath, input);
  await writeFile(
    overridesPath,
    JSON.stringify({
      schemaVersion: '1.0',
      feedSources: { feed: { sha256: sha256(input) } },
      overrides: [
        {
          feedId: 'feed',
          stopId: 'A',
          active: true,
          reviewed: true,
          confidence: 'high',
          reason: 'verified entrance',
          sourceEvidence: 'OSM node 1',
          createdAt: '2026-09-27T00:00:00Z',
          override: {
            lat: 35.2,
            lon: 139.2,
            osmElementType: 'node',
            osmElementId: '1',
          },
        },
      ],
    }),
  );
  const first = await applyOverrides({
    inputPath,
    outputPath: outputOne,
    overridesPath,
    feedId: 'feed',
  });
  const second = await applyOverrides({
    inputPath,
    outputPath: outputTwo,
    overridesPath,
    feedId: 'feed',
  });
  assert.equal(first.outputSha256, second.outputSha256);
  assert.equal(first.appliedCount, 1);
  const stops = strFromU8(unzipSync(await readFile(outputOne))['stops.txt']);
  assert.match(stops, /A,"Alpha, Station",35\.2,139\.2/);
});

test('rejects active low-confidence overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tcache-linking-'));
  const input = zipSync({
    'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\nA,A,35,139\n'),
  });
  const inputPath = join(root, 'input.zip');
  const overridesPath = join(root, 'overrides.json');
  await writeFile(inputPath, input);
  await writeFile(
    overridesPath,
    JSON.stringify({
      schemaVersion: '1.0',
      feedSources: { feed: { sha256: sha256(input) } },
      overrides: [
        {
          feedId: 'feed',
          stopId: 'A',
          active: true,
          reviewed: false,
          confidence: 'low',
          reason: 'guess',
          sourceEvidence: 'none',
          createdAt: '2026-09-27T00:00:00Z',
          override: {
            lat: 35.1,
            lon: 139.1,
            osmElementType: 'node',
            osmElementId: '1',
          },
        },
      ],
    }),
  );
  await assert.rejects(
    applyOverrides({
      inputPath,
      outputPath: join(root, 'output.zip'),
      overridesPath,
      feedId: 'feed',
    }),
    /must be reviewed with high confidence/,
  );
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
