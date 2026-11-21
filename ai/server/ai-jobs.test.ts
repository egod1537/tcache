import { afterEach, describe, expect, it, vi } from 'vitest';

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
  AiProviderSelectionError,
  type AiProvider,
  type AiProviderResult,
} from './providers/provider.js';
import { OpenWebUIAiProvider } from './providers/openwebui/client.js';
import { OpenWebUIModelService } from './providers/openwebui/models.js';
import { isAiProviderResponse } from './providers/provider-json.js';
import { extractAiText } from './providers/result-text.js';
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
  async list(limit: number, sessionOwner?: string) {
    return [...this.jobs.values()]
      .filter((job) => !sessionOwner || job.sessionOwner === sessionOwner)
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

class NetworkFailureProvider extends TestProvider {
  override async generate(): Promise<AiProviderResult> {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
        code: 'ECONNREFUSED',
      }),
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
  provider: AiProvider | AiProvider[],
  providerTimeoutMs = 1_000,
  cache = new MemoryCache(),
  context: {
    requestDefaults?: {
      provider: string;
      models: Partial<Record<string, string>>;
    };
    openWebUIModels?: OpenWebUIModelService;
  } = {},
) {
  const store = new MemoryJobStore();
  const events = new InMemoryAiJobEventBus();
  const runner = new AiJobRunner({
    store,
    events,
    cache,
    cachePolicy: createAiCachePolicy(3_600),
    providers: new AiProviderRegistry(
      Array.isArray(provider) ? provider : [provider],
    ),
    providerTimeoutMs,
  });
  const jobs = new AiJobService(store, events, runner);
  const app = buildApp({ aiCache: { jobs, events, ...context } });
  app.addHook('onRequest', async (request) => {
    request.headers.cookie ??= 'tcache_ai_session=' + 'a'.repeat(43);
  });
  apps.push(app);
  return { app, store, cache, jobs, events };
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI jobs', () => {
  it('extracts representative text across normalized provider results', () => {
    expect(
      extractAiText({
        candidates: [
          { content: { parts: [{ text: 'Gemini ' }, { text: 'answer' }] } },
        ],
      }),
    ).toBe('Gemini answer');
    expect(
      extractAiText({
        choices: [{ message: { content: 'OpenWebUI answer' } }],
      }),
    ).toBe('OpenWebUI answer');
  });

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

  it.each([
    ['gemini', 'gemini-test'],
    ['openwebui', 'qwen-test'],
    ['mock', 'mock-ai-v1'],
  ])('applies the %s provider default model', (provider, model) => {
    expect(
      normalizeAiRequest(
        {
          provider,
          model: ' ',
          messages: [{ role: 'user', content: 'hello' }],
        },
        {
          provider: 'mock',
          models: {
            gemini: 'gemini-test',
            openwebui: 'qwen-test',
            mock: 'mock-ai-v1',
          },
        },
      ),
    ).toMatchObject({ provider, model });
  });

  it('applies the server default provider and model before creating a job', async () => {
    const provider = new TestProvider();
    const { app } = createTestApp(provider, 1_000, new MemoryCache(), {
      requestDefaults: {
        provider: 'test',
        models: { test: 'test-default' },
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
      },
    });
    expect(created.statusCode).toBe(202);
    const job = await waitForTerminal(
      app,
      created.json<{ jobId: string }>().jobId,
    );
    expect(job).toMatchObject({
      status: 'completed',
      provider: 'test',
      model: 'test-default',
    });
  });

  it('ignores object order even for option keys with equivalent Unicode collation', () => {
    const left = normalizeAiRequest({
      ...requestBody,
      options: { é: 1, 'e\u0301': 2 },
    });
    const right = normalizeAiRequest({
      ...requestBody,
      options: { 'e\u0301': 2, é: 1 },
    });
    expect(createAiCacheKey(left)).toBe(createAiCacheKey(right));
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
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toMatchObject({
      status: 'completed',
      cache: { hit: false },
      provider: 'test',
      model: 'test-model',
      text: 'answer',
      request: {
        systemPrompt: 'sensitive system prompt',
        messages: [{ role: 'user', content: 'sensitive user context' }],
        options: { temperature: 0.2 },
      },
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

  it('issues an isolated session and denies another browser every Job endpoint', async () => {
    const provider = new TestProvider();
    const { app } = createTestApp(provider);
    const post = (cookie: string) =>
      app.inject({
        method: 'POST',
        url: '/api/ai/jobs',
        headers: { cookie },
        payload: requestBody,
      });
    const own = await post('');
    const other = await post('');
    const ownSetCookie = String(own.headers['set-cookie']);
    expect(ownSetCookie).toMatch(
      /; Path=\/api\/ai\/jobs; HttpOnly; SameSite=Strict/,
    );
    const ownCookie = ownSetCookie.split(';')[0];
    const otherCookie = String(other.headers['set-cookie']).split(';')[0];
    expect(ownCookie).not.toBe(otherCookie);
    const { jobId } = own.json<{ jobId: string }>();
    const otherId = other.json<{ jobId: string }>().jobId;
    const get = (url: string, cookie: string) =>
      app.inject({ method: 'GET', url, headers: { cookie } });
    const root = `/api/ai/jobs/${jobId}`;
    expect((await get(root, '')).statusCode).toBe(404);
    for (const path of [root, root + '/result', root + '/events']) {
      expect((await get(path, otherCookie)).statusCode).toBe(404);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: root + '/cancel',
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404);
    const listed = await get('/api/ai/jobs', otherCookie);
    expect(listed.json().jobs.map((job: AiJob) => job.jobId)).toEqual([
      otherId,
    ]);
    await vi.waitFor(async () => {
      const result = await get(root + '/result', ownCookie);
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        text: 'answer',
        cache: { hit: false },
      });
    });
    await vi.waitFor(async () => {
      const result = await get(`/api/ai/jobs/${otherId}/result`, otherCookie);
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ cache: { hit: false } });
    });
    expect(provider.calls).toBe(2);
  });

  it('redacts a configured provider key echoed in successful Raw JSON', async () => {
    const secret = 'fixture-provider-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: 'provider response' } }],
          diagnostic: { authorization: 'Bearer ' + secret },
        }),
      ),
    );
    const { app } = createTestApp(
      new OpenWebUIAiProvider('http://openwebui.test', secret),
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: { ...requestBody, provider: 'openwebui', model: 'local-model' },
    });
    const { jobId } = created.json<{ jobId: string }>();
    await waitForTerminal(app, jobId);
    const result = await app.inject({ url: `/api/ai/jobs/${jobId}/result` });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain(secret);
    expect(result.json()).toMatchObject({
      text: 'provider response',
      result: { diagnostic: { authorization: 'Bearer [REDACTED]' } },
    });
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

  it('uses an OpenWebUI cached response without a second upstream call', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', upstream);
    const provider = new OpenWebUIAiProvider('http://openwebui.test');
    const { app } = createTestApp(provider);
    const payload = {
      ...requestBody,
      provider: 'openwebui',
      model: 'qwen-test',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload,
    });
    const firstJobId = first.json<{ jobId: string }>().jobId;
    await waitForTerminal(app, firstJobId);
    const firstResult = await app.inject({
      method: 'GET',
      url: `/api/ai/jobs/${firstJobId}/result`,
    });
    expect(firstResult.json()).toMatchObject({ text: 'answer' });
    const second = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload,
    });
    const job = await waitForTerminal(
      app,
      second.json<{ jobId: string }>().jobId,
    );
    expect(job.cache).toMatchObject({ hit: true });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([{ error: { message: 'upstream error' } }, { choices: [] }])(
    'does not cache an invalid successful-looking OpenWebUI response: %j',
    async (invalid) => {
      const upstream = vi
        .fn()
        .mockResolvedValueOnce(Response.json(invalid))
        .mockResolvedValueOnce(
          Response.json({ choices: [{ message: { content: 'answer' } }] }),
        );
      vi.stubGlobal('fetch', upstream);
      const { app, cache } = createTestApp(
        new OpenWebUIAiProvider('http://openwebui.test'),
      );
      const payload = { ...requestBody, provider: 'openwebui', model: 'qwen' };

      const submit = async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/ai/jobs',
          payload,
        });
        expect(response.statusCode).toBe(202);
        return waitForTerminal(app, response.json<{ jobId: string }>().jobId);
      };

      expect(await submit()).toMatchObject({
        status: 'failed',
        error: { code: 'AI_PROVIDER_ERROR' },
      });
      expect(cache.values.size).toBe(0);
      expect(await submit()).toMatchObject({
        status: 'completed',
        cache: { hit: false },
      });
      expect(upstream).toHaveBeenCalledTimes(2);
    },
  );

  it('accepts provider tool completions and rejects empty Gemini responses', () => {
    expect(
      isAiProviderResponse('openwebui', {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ function: { name: 'lookup', arguments: '{}' } }],
            },
          },
        ],
      }),
    ).toBe(true);
    expect(
      isAiProviderResponse('gemini', {
        candidates: [
          { content: { parts: [{ functionCall: { name: 'lookup' } }] } },
        ],
      }),
    ).toBe(true);
    expect(
      isAiProviderResponse('gemini', {
        candidates: [{ content: { parts: [{}] }, finishReason: 'SAFETY' }],
      }),
    ).toBe(false);
  });

  it('cancels provider work idempotently', async () => {
    const { app, events } = createTestApp(new BlockingProvider());
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const terminalEvents: string[] = [];
    const unsubscribe = events.subscribe(jobId, (event) => {
      if (event.type === 'cancelled') terminalEvents.push(event.type);
    });
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
    expect(terminalEvents).toEqual(['cancelled']);
    unsubscribe();
  });

  it('finishes atomically when a cache write already won the completion lock', async () => {
    const cache = new MemoryCache();
    let releaseWrite: () => void = () => {};
    let notifyWrite: () => void = () => {};
    const writing = new Promise<void>((resolve) => {
      notifyWrite = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const set = cache.set.bind(cache);
    vi.spyOn(cache, 'set').mockImplementation(async (key, value) => {
      notifyWrite();
      await release;
      await set(key, value);
    });
    const { app, events } = createTestApp(new TestProvider(), 1000, cache);
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: requestBody,
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    const terminal: string[] = [];
    const unsubscribe = events.subscribe(jobId, (event) => {
      if (event.type === 'completed' || event.type === 'cancelled')
        terminal.push(event.type);
    });
    await writing;
    const cancelling = app.inject({
      method: 'POST',
      url: `/api/ai/jobs/${jobId}/cancel`,
    });
    try {
      expect(
        await Promise.race([
          cancelling.then(() => 'cancelled early'),
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 30)),
        ]),
      ).toBe('waiting');
    } finally {
      releaseWrite();
    }
    expect((await cancelling).json()).toEqual({ jobId, status: 'completed' });
    expect(terminal).toEqual(['completed']);
    expect(cache.values.size).toBe(1);
    unsubscribe();
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

  it('adds the network cause code to bare provider fetch failures', async () => {
    const { app } = createTestApp(new NetworkFailureProvider());
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
      error: {
        code: 'AI_PROVIDER_ERROR',
        message: 'fetch failed (ECONNREFUSED)',
      },
    });
    expect(JSON.stringify(job)).not.toContain('127.0.0.1');
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

  it('selects OpenWebUI and rejects an empty unsupported model', () => {
    const registry = new AiProviderRegistry([
      new OpenWebUIAiProvider('http://openwebui.test'),
    ]);
    expect(registry.select('openwebui', 'qwen-test').name).toBe('openwebui');
    expect(() => registry.select('openwebui', ' ')).toThrow(
      AiProviderSelectionError,
    );
  });

  it('maps and returns a successful OpenWebUI chat completion', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', upstream);
    const provider = new OpenWebUIAiProvider(
      'http://openwebui.test/',
      'secret-key',
    );
    const result = await provider.generate(
      normalizeAiRequest({
        ...requestBody,
        provider: 'openwebui',
        model: 'qwen-test',
      }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      provider: 'openwebui',
      model: 'qwen-test',
      result: { choices: [{ message: { content: 'hello' } }] },
    });
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://openwebui.test/api/chat/completions');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'qwen-test',
      stream: false,
      messages: [
        { role: 'system', content: 'sensitive system prompt' },
        { role: 'user', content: 'sensitive user context' },
      ],
      temperature: 0.2,
    });
  });

  it('normalizes an OpenWebUI HTTP error without exposing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail:
              'model unavailable for sensitive user context and key never-expose-me',
          }),
          { status: 502 },
        ),
      ),
    );
    const provider = new OpenWebUIAiProvider(
      'http://openwebui.test',
      'never-expose-me',
    );
    const failure = await provider
      .generate(
        normalizeAiRequest({
          ...requestBody,
          provider: 'openwebui',
          model: 'missing-model',
        }),
        new AbortController().signal,
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('HTTP 502');
    expect((failure as Error).message).not.toContain('never-expose-me');
    expect((failure as Error).message).not.toContain('sensitive user context');
  });

  it('passes AbortSignal through to OpenWebUI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const provider = new OpenWebUIAiProvider('http://openwebui.test');
    const controller = new AbortController();
    const pending = provider.generate(
      normalizeAiRequest({
        ...requestBody,
        provider: 'openwebui',
        model: 'qwen-test',
      }),
      controller.signal,
    );
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('times out an OpenWebUI Job through the existing runner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const { app } = createTestApp(
      new OpenWebUIAiProvider('http://openwebui.test'),
      20,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      payload: {
        ...requestBody,
        provider: 'openwebui',
        model: 'qwen-test',
      },
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

  it('returns normalized OpenWebUI models', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'qwen:9b', name: 'Qwen 9B' },
            { model: 'llama:latest' },
            { id: 'qwen:9b', name: 'Qwen duplicate' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', upstream);
    const { app } = createTestApp(
      new TestProvider(),
      1_000,
      new MemoryCache(),
      {
        openWebUIModels: new OpenWebUIModelService('http://openwebui.test'),
      },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/ai/providers/openwebui/models',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: 'openwebui',
      models: [
        { id: 'llama:latest', name: 'llama:latest' },
        { id: 'qwen:9b', name: 'Qwen duplicate' },
      ],
    });
    expect(upstream).toHaveBeenCalledWith(
      'http://openwebui.test/api/models',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
      }),
    );
  });

  it('returns a safe 503 when OpenWebUI model discovery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'not authorized' }), {
          status: 401,
        }),
      ),
    );
    const { app } = createTestApp(
      new TestProvider(),
      1_000,
      new MemoryCache(),
      {
        openWebUIModels: new OpenWebUIModelService(
          'http://openwebui.test',
          'private-key',
        ),
      },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/ai/providers/openwebui/models',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'OPENWEBUI_UNAVAILABLE',
        message: expect.stringContaining('HTTP 401'),
      },
    });
    expect(response.body).not.toContain('private-key');
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
    // The legacy Job can finish internally without becoming visible to a
    // browser session that never owned it.
    await vi.waitFor(async () => {
      expect(await jobs.get('ai_resumed')).toMatchObject({
        status: 'completed',
        progress: 100,
      });
    });
    expect(
      (await app.inject({ url: '/api/ai/jobs/ai_resumed/result' })).statusCode,
    ).toBe(404);
  });
});
