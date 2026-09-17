import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/server/src/app.js';
import { createAiCacheKey } from './cache/key.js';
import { createAiCachePolicy } from './cache/policy.js';
import type {
  AiCacheRepository,
  CachedAiResponse,
} from './cache/repository.js';
import type { AiJob } from './jobs/ai-job.js';
import { InMemoryAiJobEventBus } from './jobs/ai-job-events.js';
import { AiJobRunner } from './jobs/ai-job-runner.js';
import { AiJobService } from './jobs/ai-job-service.js';
import type { AiJobStore } from './jobs/ai-job-store.js';
import {
  AiProviderRegistry,
  type AiProvider,
  type AiProviderResult,
} from './providers/provider.js';
import type { NormalizedAiRequest } from './types/ai.js';
import { normalizeAiRequest } from './types/ai.js';

class MemoryJobStore implements AiJobStore {
  readonly jobs = new Map<string, AiJob>();
  async save(job: AiJob) {
    this.jobs.set(job.jobId, structuredClone(job));
  }
  async get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }
  async list(limit: number) {
    return [...this.jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }
}

class MemoryCache implements AiCacheRepository {
  readonly values = new Map<string, CachedAiResponse>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: CachedAiResponse) {
    this.values.set(key, value);
  }
}

class TestProvider implements AiProvider {
  readonly name = 'test';
  calls = 0;
  supports(model: string) {
    return model.startsWith('test-');
  }
  async generate(
    request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    void signal;
    this.calls += 1;
    return {
      provider: this.name,
      model: request.model,
      result: { text: 'answer', usage: { inputTokens: 3, outputTokens: 1 } },
    };
  }
}

class BlockingProvider extends TestProvider {
  override async generate(
    _request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  }
}

const apps: ReturnType<typeof buildApp>[] = [];
const requestBody = {
  provider: 'test',
  model: 'test-model',
  systemPrompt: 'sensitive system prompt',
  promptVersion: 'v1',
  messages: [{ role: 'user', content: 'sensitive user context' }],
  options: { temperature: 0.2 },
  cache: { enabled: true },
};

function createTestApp(
  provider: AiProvider,
  providerTimeoutMs = 1_000,
  cache = new MemoryCache(),
) {
  const store = new MemoryJobStore();
  const events = new InMemoryAiJobEventBus();
  const runner = new AiJobRunner({
    store,
    events,
    cache,
    cachePolicy: createAiCachePolicy(3_600),
    providers: new AiProviderRegistry([provider]),
    providerTimeoutMs,
  });
  const jobs = new AiJobService(store, events, runner);
  const app = buildApp({ aiCache: { jobs, events } });
  apps.push(app);
  return { app, store, cache, jobs };
}

async function waitForTerminal(
  app: ReturnType<typeof buildApp>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/ai/jobs/${jobId}`,
    });
    const job = response.json<AiJob>();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('AI job did not reach a terminal state');
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('AI jobs', () => {
  it('builds stable keys from every generation-affecting input', () => {
    const base = {
      ...requestBody,
      options: { temperature: 0.2, maxOutputTokens: 100 },
      tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
      responseSchema: { type: 'object' },
    };
    const key = createAiCacheKey(normalizeAiRequest(base));
    expect(
      createAiCacheKey(
        normalizeAiRequest({
          ...base,
          options: { maxOutputTokens: 100, temperature: 0.2 },
        }),
      ),
    ).toBe(key);

    const variants = [
      { provider: 'other' },
      { model: 'test-other' },
      { systemPrompt: 'other system prompt' },
      { promptVersion: 'v2' },
      { messages: [{ role: 'user', content: 'other message' }] },
      { options: { temperature: 0.8, maxOutputTokens: 100 } },
      { tools: [{ functionDeclarations: [{ name: 'other' }] }] },
      { responseSchema: { type: 'array' } },
    ];
    for (const variant of variants) {
      expect(
        createAiCacheKey(normalizeAiRequest({ ...base, ...variant })),
      ).not.toBe(key);
    }
  });

  it('creates a background job and exposes redacted status, SSE, and result', async () => {
    const { app } = createTestApp(new TestProvider());
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    expect(created.statusCode).toBe(202);
    const jobId = created.json<{ jobId: string }>().jobId;
    expect(jobId).toMatch(/^ai_/);
    const job = await waitForTerminal(app, jobId);
    expect(job).toMatchObject({
      status: 'completed',
      progress: 100,
      provider: 'test',
      model: 'test-model',
      requestMetadata: { messageCount: 1, hasSystemPrompt: true },
    });
    expect(JSON.stringify(job)).not.toContain('sensitive system prompt');
    expect(JSON.stringify(job)).not.toContain('sensitive user context');

    const result = await app.inject({
      method: 'GET',
      url: `/api/ai/jobs/${jobId}/result`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: 'completed',
      cache: { hit: false },
      provider: 'test',
      model: 'test-model',
      result: { text: 'answer' },
    });

    const events = await app.inject({
      method: 'GET',
      url: `/api/ai/jobs/${jobId}/events`,
    });
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.body).toContain('event: snapshot');
    expect(events.body).toContain('event: completed');
    expect(events.body).not.toContain('sensitive user context');
  });

  it('uses cached responses without calling the provider twice', async () => {
    const provider = new TestProvider();
    const { app } = createTestApp(provider);
    const first = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    await waitForTerminal(app, first.json<{ jobId: string }>().jobId);
    const second = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    const job = await waitForTerminal(
      app,
      second.json<{ jobId: string }>().jobId,
    );
    expect(job.cache).toMatchObject({ hit: true });
    expect(provider.calls).toBe(1);
  });

  it('cancels provider work idempotently', async () => {
    const { app } = createTestApp(new BlockingProvider());
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/ai/jobs/${jobId}/cancel`,
    });
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/ai/jobs/${jobId}/cancel`,
    });
    expect(cancelled.json()).toEqual({ jobId, status: 'cancelled' });
    expect(repeated.json()).toEqual({ jobId, status: 'cancelled' });
  });

  it('fails jobs that exceed the provider timeout', async () => {
    const { app } = createTestApp(new BlockingProvider(), 20);
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    const job = await waitForTerminal(
      app,
      created.json<{ jobId: string }>().jobId,
    );
    expect(job).toMatchObject({
      status: 'failed',
      error: { code: 'AI_PROVIDER_TIMEOUT' },
    });
  });

  it('rejects malformed requests before creating a job', async () => {
    const { app, store } = createTestApp(new TestProvider());
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: { provider: 'test', model: 'test-model', messages: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(store.jobs.size).toBe(0);
  });

  it('reports unsupported providers and models as distinct job failures', async () => {
    const { app } = createTestApp(new TestProvider());
    const unsupportedProvider = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: { ...requestBody, provider: 'openai' },
    });
    const providerJob = await waitForTerminal(
      app,
      unsupportedProvider.json<{ jobId: string }>().jobId,
    );
    expect(providerJob.error?.code).toBe('PROVIDER_NOT_SUPPORTED');

    const unsupportedModel = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: { ...requestBody, model: 'other-model' },
    });
    const modelJob = await waitForTerminal(
      app,
      unsupportedModel.json<{ jobId: string }>().jobId,
    );
    expect(modelJob.error?.code).toBe('MODEL_NOT_SUPPORTED');
  });

  it('resumes queued or running jobs after a server restart', async () => {
    const { app, store, jobs } = createTestApp(new TestProvider());
    const now = new Date().toISOString();
    await store.save({
      jobId: 'ai_resumed',
      status: 'running',
      stage: 'calling_provider',
      progress: 40,
      provider: 'test',
      model: 'test-model',
      message: 'Interrupted',
      createdAt: now,
      updatedAt: now,
      request: requestBody,
      requestMetadata: {
        provider: 'test',
        model: 'test-model',
        messageCount: 1,
        promptHash: 'hash',
        promptVersion: 'v1',
        hasSystemPrompt: true,
        optionKeys: ['temperature'],
        toolCount: 0,
        hasResponseSchema: false,
        cacheEnabled: true,
      },
    });
    expect(await jobs.resumePending()).toBe(1);
    expect(await waitForTerminal(app, 'ai_resumed')).toMatchObject({
      status: 'completed',
      progress: 100,
    });
  });
});
