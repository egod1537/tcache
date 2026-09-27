import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileSystemNormalizedDatasetStore,
  FileSystemRawArtifactStore,
  createDatasetIdentity,
  createRawArtifactManifest,
  hashRawArtifactManifest,
  parseRawArtifactManifest,
  type CollectedResponse,
} from '../common/index.js';
import { makeValidDataset } from './fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('manifest and dataset hashing', () => {
  it('uses content and parser inputs, not source hash order or collection time, for dataset identity', () => {
    const first = createDatasetIdentity({
      operator: 'jr-east',
      timetableEdition: '2026-09',
      sourceArtifactHashes: ['b'.repeat(64), 'a'.repeat(64)],
      parserVersion: '1.2.3',
    });
    const second = createDatasetIdentity({
      operator: 'jr-east',
      timetableEdition: '2026-09',
      sourceArtifactHashes: ['a'.repeat(64), 'b'.repeat(64)],
      parserVersion: '1.2.3',
    });

    expect(first).toEqual(second);
    expect(
      createDatasetIdentity({
        operator: 'jr-east',
        timetableEdition: '2026-09',
        sourceArtifactHashes: ['a'.repeat(64), 'b'.repeat(64)],
        parserVersion: '1.2.4',
      }).datasetVersion,
    ).not.toBe(first.datasetVersion);
  });

  it('records every required raw artifact field in a deterministic manifest hash', () => {
    const response = makeResponse();
    const manifest = createRawArtifactManifest(response, 'collector/0.1.0');
    const reparsed = parseRawArtifactManifest(
      JSON.parse(JSON.stringify(manifest)),
    );

    expect(reparsed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reparsed.byteLength).toBe(response.body.byteLength);
    expect(hashRawArtifactManifest(reparsed)).toBe(
      hashRawArtifactManifest(manifest),
    );
  });

  it('stores raw HTML separately and keeps immutable per-request manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tcache-jr-artifacts-'));
    temporaryDirectories.push(root);
    const store = new FileSystemRawArtifactStore(root);

    const first = await store.put(makeResponse(), 'collector/0.1.0');
    const second = await store.put(
      { ...makeResponse(), requestedAt: '2026-09-27T03:01:00Z' },
      'collector/0.1.0',
    );

    expect(second.artifactPath).toBe(first.artifactPath);
    expect(second.manifestPath).not.toBe(first.manifestPath);
    expect(await readFile(first.artifactPath, 'utf8')).toContain('<table>');
    expect(JSON.parse(await readFile(first.manifestPath, 'utf8'))).toEqual(
      first.manifest,
    );
  });

  it('stores a validated normalized dataset only under parsed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tcache-jr-parsed-'));
    temporaryDirectories.push(root);
    const store = new FileSystemNormalizedDatasetStore(root);

    const stored = await store.put(makeValidDataset());

    expect(stored.datasetPath).toContain(`${join(root, 'parsed')}/`);
    expect(stored.datasetPath).toContain(stored.datasetHash);
    expect(
      JSON.parse(await readFile(stored.datasetPath, 'utf8')),
    ).toMatchObject({
      schemaVersion: '1.0',
      metadata: { datasetVersion: stored.datasetVersion },
    });
  });
});

function makeResponse(): CollectedResponse {
  return {
    request: {
      sourceUrl: 'https://example.invalid/timetable/123.html',
      sourceEdition: '2026-09',
      sourceType: 'station-timetable-html',
      operator: 'jr-east',
    },
    requestedAt: '2026-09-27T03:00:00Z',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    body: new TextEncoder().encode('<table></table>'),
  };
}
