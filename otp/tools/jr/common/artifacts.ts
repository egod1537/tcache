import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  CollectedResponse,
  NormalizedDatasetStore,
  RawArtifactStore,
  StoredNormalizedDataset,
  StoredRawArtifact,
} from './contracts.js';
import { canonicalJson, hashCanonicalJson, sha256Bytes } from './hash.js';
import {
  parseNormalizedTimetable,
  parseRawArtifactManifest,
} from './schema.js';
import {
  RAW_ARTIFACT_SCHEMA_VERSION,
  type NormalizedTimetable,
  type RawArtifactManifest,
} from './types.js';

export function createRawArtifactManifest(
  response: CollectedResponse,
  collectorVersion: string,
): RawArtifactManifest {
  return {
    schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION,
    sourceUrl: response.request.sourceUrl,
    requestedAt: response.requestedAt,
    httpStatus: response.httpStatus,
    contentType: response.contentType,
    sha256: sha256Bytes(response.body),
    byteLength: response.body.byteLength,
    sourceEdition: response.request.sourceEdition,
    sourceType: response.request.sourceType,
    operator: response.request.operator,
    collectorVersion,
  };
}

export function hashRawArtifactManifest(manifest: RawArtifactManifest): string {
  return hashCanonicalJson(manifest);
}

export class FileSystemRawArtifactStore implements RawArtifactStore {
  constructor(private readonly datasetRoot: string) {}

  async put(
    response: CollectedResponse,
    collectorVersion: string,
  ): Promise<StoredRawArtifact> {
    const manifest = parseRawArtifactManifest(
      createRawArtifactManifest(response, collectorVersion),
    );
    const manifestHash = hashRawArtifactManifest(manifest);
    const extension = extensionFor(
      response.request.sourceUrl,
      response.contentType,
    );
    const artifactPath = join(
      this.datasetRoot,
      'raw',
      `${manifest.sha256}${extension}`,
    );
    const manifestPath = join(
      this.datasetRoot,
      'manifests',
      `${manifestHash}.json`,
    );

    await mkdir(join(this.datasetRoot, 'raw'), { recursive: true });
    await mkdir(join(this.datasetRoot, 'manifests'), { recursive: true });
    await writeImmutable(artifactPath, response.body);
    const manifestBytes = new TextEncoder().encode(
      `${canonicalJson(manifest)}\n`,
    );
    await writeImmutable(manifestPath, manifestBytes);

    return { manifest, manifestHash, artifactPath, manifestPath };
  }
}

export class FileSystemNormalizedDatasetStore implements NormalizedDatasetStore {
  constructor(private readonly datasetRoot: string) {}

  async put(dataset: NormalizedTimetable): Promise<StoredNormalizedDataset> {
    const validatedDataset = parseNormalizedTimetable(dataset);
    const datasetHash = hashCanonicalJson(validatedDataset);

    const parsedDirectory = join(this.datasetRoot, 'parsed');
    const datasetPath = join(parsedDirectory, `${datasetHash}.json`);
    const datasetBytes = new TextEncoder().encode(
      `${canonicalJson(validatedDataset)}\n`,
    );
    await mkdir(parsedDirectory, { recursive: true });
    await writeImmutable(datasetPath, datasetBytes);
    return {
      datasetVersion: validatedDataset.metadata.datasetVersion,
      manifestHash: validatedDataset.metadata.manifestHash,
      datasetHash,
      datasetPath,
    };
  }
}

async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    await access(path, constants.R_OK);
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Immutable artifact collision at ${path}`);
    }
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function extensionFor(sourceUrl: string, contentType: string): string {
  const contentTypeWithoutParameters = contentType
    .split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentTypeWithoutParameters === 'text/html') return '.html';
  if (contentTypeWithoutParameters === 'application/json') return '.json';

  try {
    const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension;
  } catch {
    // The schema validator reports malformed URLs; storage safely falls back to .bin.
  }
  return '.bin';
}
