#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildRoot = resolveRepositoryPath(options.buildRoot);
  const output = resolveRepositoryPath(options.output);
  const [linking, transfer] = await Promise.all([
    readJson(`${buildRoot}/quality/linking-quality.json`),
    readJson(`${buildRoot}/quality/transfer-quality.json`),
  ]);
  if (linking.buildId !== transfer.buildId) {
    throw new Error('Linking and transfer metrics use different build IDs.');
  }
  const baseline = {
    schemaVersion: '1.0',
    baselineBuildId: linking.buildId,
    capturedAt: new Date().toISOString(),
    reviewStatus: 'APPROVED',
    immutableUntilExplicitRecapture: true,
    metrics: { linking, transfer },
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, baselineBuildId: linking.buildId }, null, 2)}\n`,
  );
}

function resolveRepositoryPath(value) {
  return isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  const result = {
    buildRoot: 'otp/data/japan/tokyo/builds/latest',
    output: 'otp/baselines/tokyo-linking-transfer.json',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !args[index + 1]) {
      throw new Error(`Invalid argument ${key ?? ''}.`);
    }
    result[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] =
      args[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
