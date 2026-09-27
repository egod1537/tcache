#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { parseCsv } from './diagnose.mjs';

const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z');

export async function applyOverrides({
  inputPath,
  outputPath,
  overridesPath,
  feedId,
  manifestPath,
}) {
  const [input, configText] = await Promise.all([
    readFile(inputPath),
    readFile(overridesPath, 'utf8'),
  ]);
  const config = JSON.parse(configText);
  validateConfig(config);
  const inputSha256 = sha256(input);
  const expectedSha = config.feedSources?.[feedId]?.sha256;
  if (!expectedSha) throw new Error(`No source hash declared for ${feedId}.`);
  if (inputSha256 !== expectedSha) {
    throw new Error(
      `Immutable source hash mismatch for ${feedId}: expected ${expectedSha}, got ${inputSha256}.`,
    );
  }

  const allForFeed = config.overrides.filter((item) => item.feedId === feedId);
  const active = allForFeed.filter((item) => item.active !== false);
  for (const item of active) validateActiveOverride(item);
  const duplicateIds = duplicates(active.map((item) => item.stopId));
  if (duplicateIds.length) {
    throw new Error(
      `Duplicate overrides for ${feedId}: ${duplicateIds.join(', ')}`,
    );
  }

  const archive = unzipSync(new Uint8Array(input));
  const stopsEntry = archive['stops.txt'];
  if (!stopsEntry) throw new Error(`${inputPath} has no stops.txt.`);
  const sourceText = strFromU8(stopsEntry).replace(/^\uFEFF/, '');
  const header = parseCsvHeader(sourceText);
  const rows = parseCsv(sourceText);
  const byStopId = new Map(rows.map((row) => [row.stop_id, row]));
  const applied = [];
  for (const item of active) {
    const row = byStopId.get(item.stopId);
    if (!row) throw new Error(`${feedId} stop ${item.stopId} does not exist.`);
    const before = { lat: Number(row.stop_lat), lon: Number(row.stop_lon) };
    row.stop_lat = formatCoordinate(item.override.lat);
    row.stop_lon = formatCoordinate(item.override.lon);
    applied.push({
      feedId,
      stopId: item.stopId,
      stopName: row.stop_name,
      before,
      after: { lat: item.override.lat, lon: item.override.lon },
      osmElementType: item.override.osmElementType,
      osmElementId: item.override.osmElementId,
      reason: item.reason,
      reviewed: item.reviewed,
    });
  }
  archive['stops.txt'] = strToU8(serializeCsv(header, rows));
  const deterministicEntries = Object.fromEntries(
    Object.entries(archive)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, data]) => [name, [data, { mtime: ZIP_MTIME }]]),
  );
  const output = zipSync(deterministicEntries, { level: 9, mtime: ZIP_MTIME });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  const result = {
    schemaVersion: '1.0',
    feedId,
    inputPath,
    outputPath,
    inputSha256,
    outputSha256: sha256(output),
    overrideConfigSha256: sha256(Buffer.from(configText)),
    appliedCount: applied.length,
    skippedUnreviewedCount: allForFeed.length - active.length,
    applied,
  };
  if (manifestPath) {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

function validateConfig(config) {
  if (config.schemaVersion !== '1.0' || !Array.isArray(config.overrides)) {
    throw new Error('Unsupported stop override schema.');
  }
}

function validateActiveOverride(item) {
  if (item.reviewed !== true || item.confidence !== 'high') {
    throw new Error(
      `Active override ${item.feedId}/${item.stopId} must be reviewed with high confidence.`,
    );
  }
  if (!item.reason || !item.sourceEvidence || !item.createdAt) {
    throw new Error(
      `Active override ${item.feedId}/${item.stopId} lacks provenance.`,
    );
  }
  const { lat, lon, osmElementType, osmElementId } = item.override ?? {};
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !['node', 'way', 'relation'].includes(osmElementType) ||
    !String(osmElementId ?? '')
  ) {
    throw new Error(`Invalid target for ${item.feedId}/${item.stopId}.`);
  }
}

function parseCsvHeader(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  return parseCsv(`${firstLine}\n`)[0]
    ? Object.values(parseCsv(`${firstLine}\n`)[0])
    : splitCsvHeader(firstLine);
}

function splitCsvHeader(line) {
  return line.split(',').map((value) => value.replace(/^"|"$/g, ''));
}

function serializeCsv(header, rows) {
  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map((row) =>
      header.map((key) => escapeCsv(row[key] ?? '')).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function escapeCsv(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatCoordinate(value) {
  return Number(value).toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!value || !key.startsWith('--'))
      throw new Error(`Invalid argument ${key}.`);
    result[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['input', 'output', 'overrides', 'feed-id']) {
    if (!result[required]) throw new Error(`Missing --${required}.`);
  }
  return {
    inputPath: resolve(result.input),
    outputPath: resolve(result.output),
    overridesPath: resolve(result.overrides),
    feedId: result['feed-id'],
    manifestPath: result.manifest ? resolve(result.manifest) : null,
  };
}

async function main() {
  const result = await applyOverrides(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
