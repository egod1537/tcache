import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';

const serverPackage = new URL(
  '../../apps/server/package.json',
  import.meta.url,
);
const dist = new URL('./dist/', serverPackage);
const load = (file) => import(new URL(file + '.js', dist));
const ai = (file) => load('ai/server/' + file);
const { createClient } = createRequire(serverPackage)('redis');
const { buildApp } = await load('apps/server/src/app');
const { RedisAiCacheRepository } = await ai('cache/repository');
const { InMemoryAiJobEventBus } = await ai('jobs/ai-job-events');
const { AiJobRunner } = await ai('jobs/ai-job-runner');
const { AiJobService } = await ai('jobs/ai-job-service');
const { RedisAiJobStore } = await ai('jobs/ai-job-store');
const { AiProviderRegistry } = await ai('providers/provider');
const { MockAiProvider } = await ai('providers/mock/client');

const cacheTtl = 3;
const jobTtl = 300;
const pollMs = 5;
const groups = 60;
const repeats = 3;
const bypassSamples = 20;
const folder = await mkdtemp(join(tmpdir(), 'tc-cache-'));
const socket = join(folder, 'redis.sock');
const child = spawn(
  process.env.REDIS_SERVER || 'redis-server',
  [
    '--port',
    '0',
    '--unixsocket',
    socket,
    '--unixsocketperm',
    '700',
    '--save',
    '',
    '--appendonly',
    'no',
    '--dir',
    folder,
  ],
  { stdio: 'ignore' },
);
let spawnError;
child.once('error', (error) => {
  spawnError = error;
});
const redis = createClient({
  socket: { path: socket, reconnectStrategy: false },
});
redis.on('error', () => {});
let app;
let calls = 0;

class CountedMock extends MockAiProvider {
  async generate(request, signal) {
    calls += 1;
    return super.generate(request, signal);
  }
}

async function eventually(check, timeoutMs) {
  const end = performance.now() + timeoutMs;
  do {
    const result = await check();
    if (result) return result;
    await sleep(pollMs);
  } while (performance.now() < end);
  assert.fail('Timed out waiting for the expected Redis or Job state');
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

try {
  await eventually(async () => {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'isolated Redis exited');
    return stat(socket).then(
      () => true,
      () => false,
    );
  }, 5000);
  await redis.connect();
  const store = new RedisAiJobStore(redis, jobTtl);
  const events = new InMemoryAiJobEventBus();
  const runner = new AiJobRunner({
    store,
    events,
    cache: new RedisAiCacheRepository(redis),
    cachePolicy: { ttlSeconds: cacheTtl },
    providers: new AiProviderRegistry([new CountedMock()]),
    providerTimeoutMs: 3000,
  });
  app = buildApp({
    aiCache: { jobs: new AiJobService(store, events, runner), events },
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });

  async function send(path, cookie, payload) {
    const headers = cookie ? { cookie } : {};
    if (payload) headers['content-type'] = 'application/json';
    const response = await globalThis.fetch(origin + path, {
      method: payload ? 'POST' : 'GET',
      headers,
      body: payload && JSON.stringify(payload),
      signal: globalThis.AbortSignal.timeout(4000),
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie'),
      body: await response.json(),
    };
  }

  const request = (label) => ({
    provider: 'mock',
    model: 'mock-ai-v1',
    promptVersion: 'cache-policy-v1',
    systemPrompt: 'Isolated cache measurement',
    messages: [{ role: 'user', content: label }],
    context: { datasetVersion: 'static-v1', history: ['a', 'b'] },
    options: { temperature: 0 },
  });

  async function run(input, session = {}) {
    const previousCalls = calls;
    const start = performance.now();
    const job = await send('/api/ai/jobs', session.cookie, input);
    assert.equal(job.status, 202);
    if (!session.cookie) {
      assert.match(job.cookie, /HttpOnly/);
      session.cookie = job.cookie.split(';')[0];
    }
    const result = await eventually(async () => {
      const response = await send(job.body.resultUrl, session.cookie);
      if (response.status === 202) return false;
      assert.equal(response.status, 200);
      return response.body;
    }, 4000);
    assert.equal(result.text, 'Mock response for 1 message(s)');
    assert.equal(calls - previousCalls, result.cache.hit ? 0 : 1);
    return {
      ms: Number((performance.now() - start).toFixed(3)),
      cache: result.cache,
      payload: result.result,
      jobId: result.jobId,
      providerCalls: calls - previousCalls,
    };
  }

  const a = {};
  await run(request('warm-up'), a);
  await run(request('warm-up'), a);
  const cold = [];
  const hot = [];
  const bypass = [];
  const beforeCohort = calls;
  for (let group = 0; group < groups; group++) {
    const input = request('cohort-' + group);
    const first = await run(input, a);
    assert.equal(first.cache.hit, false);
    cold.push(first.ms);
    for (let repeat = 0; repeat < repeats; repeat++) {
      const reused = await run(input, a);
      assert.equal(reused.cache.hit, true);
      assert.equal(reused.cache.key, first.cache.key);
      assert.deepEqual(reused.payload, first.payload);
      hot.push(reused.ms);
    }
  }
  const cohortCalls = calls - beforeCohort;
  assert.equal(cohortCalls, groups);

  const uncached = { ...request('bypass-control'), cache: { enabled: false } };
  for (let sample = 0; sample < bypassSamples; sample++) {
    const result = await run(uncached, a);
    assert.equal(result.cache.enabled, false);
    assert.equal(await redis.exists('tcache:ai:cache:' + result.cache.key), 0);
    bypass.push(result.ms);
  }

  const ttlInput = request('expiry-control');
  const fresh = await run(ttlInput, a);
  const redisKey = 'tcache:ai:cache:' + fresh.cache.key;
  const ttlBeforeMs = await redis.pTTL(redisKey);
  assert.ok(ttlBeforeMs > 0 && ttlBeforeMs <= cacheTtl * 1000);
  await eventually(async () => (await redis.exists(redisKey)) === 0, 6000);
  const expired = await run(ttlInput, a);
  assert.equal(expired.cache.hit, false);
  assert.equal(expired.cache.key, fresh.cache.key);

  const versionInput = request('dataset-and-session-control');
  const known = await run(versionInput, a);
  const changed = await run(
    {
      ...versionInput,
      context: { ...versionInput.context, datasetVersion: 'static-v2' },
    },
    a,
  );
  assert.equal(changed.cache.hit, false);
  assert.notEqual(known.cache.key, changed.cache.key);

  const b = {};
  const isolated = await run(
    { ...versionInput, sessionOwner: 'ignored-body-field' },
    b,
  );
  assert.notEqual(a.cookie, b.cookie);
  assert.equal(isolated.cache.hit, false);
  assert.notEqual(isolated.cache.key, known.cache.key);
  const protectedUrl = '/api/ai/jobs/' + known.jobId + '/result';
  assert.equal((await send(protectedUrl, b.cookie)).status, 404);
  assert.equal((await send(protectedUrl)).status, 404);
  assert.equal((await send(protectedUrl, a.cookie)).status, 200);

  const output = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    redis: (await redis.info('server')).match(/redis_version:([^\r\n]+)/)?.[1],
    node: process.version,
    os: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    measuredAt: new Date().toISOString(),
    setup: {
      provider: 'built-in Mock, fixed 500 ms delay',
      model: 'mock-ai-v1',
      cacheTtl,
      jobTtl,
      pollMs,
      groups,
      repeats,
      bypassSamples,
    },
    elapsed: {
      miss: summarize(cold),
      hit: summarize(hot),
      cacheDisabled: summarize(bypass),
    },
    cohort: {
      requests: cold.length + hot.length,
      hits: hot.length,
      misses: cold.length,
      hitRate: hot.length / (cold.length + hot.length),
      mockCalls: cohortCalls,
      avoidedCalls: hot.length,
    },
    controls: {
      ttlBeforeMs,
      afterExpiryMiss: true,
      datasetVersionSeparated: true,
      differentSessionMiss: true,
      otherSessionResult: 404,
      missingSessionResult: 404,
      cacheDisabledMockCalls: bypass.length,
    },
    externalProviderCalls: 0,
    samplesMs: { miss: cold, hit: hot, cacheDisabled: bypass },
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} finally {
  await app?.close();
  if (redis.isOpen) await redis.disconnect();
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await rm(folder, { recursive: true, force: true });
}
