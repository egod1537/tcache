import { describe, expect, it } from 'vitest';

import { createAiCacheKey } from '../server/cache/key';
import { toJobStatus, type AiJob } from '../server/jobs/ai-job';
import { CONTEXT_MESSAGE_PREFIX } from '../server/providers/context';
import { toGeminiRequest } from '../server/providers/gemini/mapper';
import { toOpenWebUIRequest } from '../server/providers/openwebui/mapper';
import { normalizeAiRequest, toAiRequestMetadata } from '../server/types/ai';
import { buildAiJobRequest, type AiRequestDraft } from './ai-request-builder';

const draft = (overrides: Partial<AiRequestDraft> = {}): AiRequestDraft => ({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  systemPrompt: 'You are a concise assistant.',
  userPrompt: ' Summarize the cache status. ',
  promptVersion: 'v1',
  temperature: '0.2',
  topP: '',
  maxOutputTokens: '',
  stopSequences: '',
  rawMessages: '',
  contextJson: '',
  cacheEnabled: true,
  ...overrides,
});

function build(overrides: Partial<AiRequestDraft> = {}) {
  const result = buildAiJobRequest(draft(overrides));
  if (!result.ok) throw new Error(result.error);
  return result.request;
}

function buildError(overrides: Partial<AiRequestDraft> = {}) {
  const result = buildAiJobRequest(draft(overrides));
  if (result.ok) throw new Error('expected a validation error');
  return result.error;
}

const allOptions = {
  temperature: '0.3',
  topP: '0.9',
  maxOutputTokens: '256',
  stopSequences: 'END\n\n###',
};

describe('AI request builder', () => {
  it('keeps the existing request shape (messages, system prompt, temperature)', () => {
    expect(build()).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      systemPrompt: 'You are a concise assistant.',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'Summarize the cache status.' }],
      options: { temperature: 0.2 },
      cache: { enabled: true },
    });
  });

  it('omits empty optional values and defers to server defaults', () => {
    expect(
      build({
        provider: '',
        model: 'ignored-without-provider',
        systemPrompt: '',
        promptVersion: ' ',
        temperature: ' ',
        topP: '',
        maxOutputTokens: ' ',
        stopSequences: '\n\n',
        cacheEnabled: false,
      }),
    ).toEqual({
      messages: [{ role: 'user', content: 'Summarize the cache status.' }],
      options: {},
      cache: { enabled: false },
    });
  });

  it.each(['', 'gemini', 'openwebui', 'mock'] as const)(
    'uses canonical option names for provider %j',
    (provider) => {
      expect(build({ provider, model: '', ...allOptions })).toMatchObject({
        options: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 256,
          stopSequences: ['END', '###'],
        },
      });
    },
  );

  it('accepts the range boundaries', () => {
    expect(
      build({ temperature: '0', topP: '0', maxOutputTokens: '1' }),
    ).toMatchObject({
      options: { temperature: 0, topP: 0, maxOutputTokens: 1 },
    });
    expect(build({ temperature: '2', topP: '1' })).toMatchObject({
      options: { temperature: 2, topP: 1 },
    });
  });

  it.each([
    [{ temperature: 'abc' }, 'Temperature must be a number.'],
    [{ temperature: '2.5' }, 'Temperature must be between 0 and 2.'],
    [{ temperature: '-0.1' }, 'Temperature must be between 0 and 2.'],
    [{ topP: 'abc' }, 'Top-P must be a number.'],
    [{ topP: 'Infinity' }, 'Top-P must be a number.'],
    [{ topP: '1.5' }, 'Top-P must be between 0 and 1.'],
    [{ topP: '-0.2' }, 'Top-P must be between 0 and 1.'],
    [{ maxOutputTokens: '0' }, 'Max output tokens must be a positive integer.'],
    [
      { maxOutputTokens: '1.5' },
      'Max output tokens must be a positive integer.',
    ],
    [{ maxOutputTokens: 'x' }, 'Max output tokens must be a positive integer.'],
  ])('rejects invalid numeric input %j', (overrides, message) => {
    expect(buildError(overrides)).toBe(message);
  });

  it('supports raw messages JSON in place of the user prompt', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' },
    ];
    expect(
      build({ rawMessages: JSON.stringify(messages), userPrompt: '' }),
    ).toMatchObject({ messages });
    expect(buildError({ rawMessages: '{' })).toBe(
      'Raw messages must be valid JSON.',
    );
    expect(buildError({ rawMessages: '{"role":"user"}' })).toBe(
      'Raw messages JSON must be an array.',
    );
    expect(buildError({ userPrompt: '  ' })).toBe('User Prompt is required.');
  });

  it('is accepted by the backend normalizer for every provider choice', () => {
    for (const provider of ['gemini', 'openwebui', 'mock'] as const) {
      const request = build({ provider, model: 'm-1', ...allOptions });
      expect(normalizeAiRequest(request).options).toEqual(request.options);
    }
  });
});

describe('Canonical options reach each provider request shape', () => {
  it('Gemini: generationConfig with Gemini names', () => {
    const request = normalizeAiRequest(
      build({ provider: 'gemini', ...allOptions }),
    );
    const wire = toGeminiRequest(request);
    expect(wire.generationConfig).toEqual({
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 256,
      stopSequences: ['END', '###'],
    });
    expect(wire.systemInstruction).toEqual({
      parts: [{ text: 'You are a concise assistant.' }],
    });
    expect(wire.contents).toEqual([
      { role: 'user', parts: [{ text: 'Summarize the cache status.' }] },
    ]);
  });

  it('OpenWebUI: top-level OpenAI-compatible names', () => {
    const request = normalizeAiRequest(
      build({ provider: 'openwebui', model: 'qwen-test', ...allOptions }),
    );
    const wire = toOpenWebUIRequest(request);
    expect(wire).toEqual({
      model: 'qwen-test',
      stream: false,
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: 256,
      stop: ['END', '###'],
      messages: [
        { role: 'system', content: 'You are a concise assistant.' },
        { role: 'user', content: 'Summarize the cache status.' },
      ],
    });
  });

  it('omits unset options from both provider requests', () => {
    const gemini = toGeminiRequest(
      normalizeAiRequest(build({ provider: 'gemini' })),
    );
    expect(gemini.generationConfig).toEqual({ temperature: 0.2 });
    const openWebUI = toOpenWebUIRequest(
      normalizeAiRequest(build({ provider: 'openwebui', model: 'qwen-test' })),
    );
    for (const key of ['top_p', 'max_tokens', 'stop', 'topP']) {
      expect(openWebUI).not.toHaveProperty(key);
    }
    const bare = toGeminiRequest(
      normalizeAiRequest(build({ provider: 'gemini', temperature: '' })),
    );
    expect(bare).not.toHaveProperty('generationConfig');
  });

  it('changes the cache key when any option changes', () => {
    const key = (overrides: Partial<AiRequestDraft>) =>
      createAiCacheKey(normalizeAiRequest(build(overrides)));
    const base = key(allOptions);
    expect(key({ ...allOptions, topP: '0.5' })).not.toBe(base);
    expect(key({ ...allOptions, maxOutputTokens: '128' })).not.toBe(base);
    expect(key({ ...allOptions, stopSequences: 'END' })).not.toBe(base);
    expect(key({ ...allOptions, topP: '' })).not.toBe(base);
    expect(base).toMatch(/^ai:v2:/);
  });
});

describe('Context JSON (first-class context field)', () => {
  const promptMessage = { role: 'user', content: 'Create a short itinerary.' };

  it('omits context when Context JSON is empty', () => {
    const base = draft({ userPrompt: 'Create a short itinerary.' });
    const withoutField = buildAiJobRequest(base);
    for (const contextJson of ['', '   ', '\n\t ']) {
      const result = buildAiJobRequest({ ...base, contextJson });
      expect(JSON.stringify(result)).toBe(JSON.stringify(withoutField));
    }
    expect(
      build({ userPrompt: 'Create a short itinerary.' }),
    ).not.toHaveProperty('context');
  });

  it('sends parsed JSON as `context` and leaves messages untouched', () => {
    const request = build({
      userPrompt: 'Create a short itinerary.',
      contextJson: '{"destination":"Tokyo","days":3}',
    });
    expect(request.context).toEqual({ destination: 'Tokyo', days: 3 });
    expect(request.messages).toEqual([promptMessage]);
    expect(JSON.stringify(request)).not.toContain(
      CONTEXT_MESSAGE_PREFIX.trim(),
    );
  });

  it('accepts arrays and primitive JSON values', () => {
    const context = (contextJson: string) => build({ contextJson }).context;
    expect(context('[1,{"a":true}]')).toEqual([1, { a: true }]);
    expect(context('"plain text"')).toBe('plain text');
    expect(context('42')).toBe(42);
    expect(context('true')).toBe(true);
    expect(context('null')).toBeNull();
  });

  it('blocks request creation on invalid JSON', () => {
    const error = buildError({ contextJson: '{"destination": ' });
    expect(error).toMatch(/^Context JSON must be valid JSON/);
    expect(buildAiJobRequest(draft({ contextJson: "{'a':1}" })).ok).toBe(false);
  });

  it('keeps Raw messages JSON unchanged alongside context', () => {
    const raw = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];
    const request = build({
      contextJson: '{"k":1}',
      rawMessages: JSON.stringify(raw),
    });
    expect(request.messages).toEqual(raw);
    expect(request.context).toEqual({ k: 1 });
  });

  it('still requires a User Prompt or raw messages', () => {
    expect(buildError({ contextJson: '{"k":1}', userPrompt: ' ' })).toBe(
      'User Prompt is required.',
    );
  });

  it('is preserved by normalizeAiRequest with canonical key order', () => {
    const normalized = normalizeAiRequest(
      build({ contextJson: '{"b":{"y":2,"x":1},"a":[{"d":1,"c":2}]}' }),
    );
    expect(normalized.context).toEqual({
      a: [{ c: 2, d: 1 }],
      b: { x: 1, y: 2 },
    });
    expect(JSON.stringify(normalized.context)).toBe(
      '{"a":[{"c":2,"d":1}],"b":{"x":1,"y":2}}',
    );
    expect(normalized.messages).toHaveLength(1);
  });

  it('reaches both providers as one deterministic leading message', () => {
    const request = (contextJson: string, provider: 'gemini' | 'openwebui') =>
      normalizeAiRequest(
        build({
          provider,
          model: provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen-test',
          userPrompt: 'Create a short itinerary.',
          contextJson,
        }),
      );
    const rendered = `${CONTEXT_MESSAGE_PREFIX}{\n  "days": 3,\n  "destination": "Tokyo"\n}`;

    const gemini = toGeminiRequest(
      request('{"destination":"Tokyo","days":3}', 'gemini'),
    );
    expect(gemini.contents).toEqual([
      { role: 'user', parts: [{ text: rendered }] },
      { role: 'user', parts: [{ text: 'Create a short itinerary.' }] },
    ]);
    expect(
      toGeminiRequest(request('{"days":3,"destination":"Tokyo"}', 'gemini')),
    ).toEqual(gemini);

    expect(
      toOpenWebUIRequest(
        request('{"destination":"Tokyo","days":3}', 'openwebui'),
      ).messages,
    ).toEqual([
      { role: 'system', content: 'You are a concise assistant.' },
      { role: 'user', content: rendered },
      promptMessage,
    ]);
  });

  it('shares a cache key across key order and differs across values', () => {
    const normalize = (contextJson: string) =>
      normalizeAiRequest(build({ contextJson }));
    const none = normalize('');
    const a = normalize('{"k":1,"nested":{"x":1,"y":2}}');
    const reordered = normalize('{ "nested" : {"y":2,"x":1}, "k": 1 }');
    const b = normalize('{"k":2,"nested":{"x":1,"y":2}}');
    const hash = (r: typeof none) => toAiRequestMetadata(r).promptHash;

    expect(createAiCacheKey(reordered)).toBe(createAiCacheKey(a));
    expect(hash(reordered)).toBe(hash(a));
    expect(createAiCacheKey(a)).not.toBe(createAiCacheKey(none));
    expect(createAiCacheKey(a)).not.toBe(createAiCacheKey(b));
    expect(hash(a)).not.toBe(hash(none));
    expect(hash(a)).not.toBe(hash(b));
    // Array order is meaningful context, not formatting.
    expect(createAiCacheKey(normalize('[1,2]'))).not.toBe(
      createAiCacheKey(normalize('[2,1]')),
    );
    expect(toAiRequestMetadata(a)).toMatchObject({
      messageCount: 1,
      hasContext: true,
    });
    expect(toAiRequestMetadata(none).hasContext).toBe(false);
  });

  it('keeps context content out of Job status / SSE payloads', () => {
    const secret = 'CTX-SECRET-VALUE';
    const request = normalizeAiRequest(
      build({ contextJson: JSON.stringify({ note: secret }) }),
    );
    const now = new Date().toISOString();
    const job: AiJob = {
      jobId: 'ai_ctx',
      status: 'running',
      stage: 'calling_provider',
      progress: 40,
      provider: request.provider,
      model: request.model,
      message: 'AI provider 응답 대기 중',
      createdAt: now,
      updatedAt: now,
      request,
      requestMetadata: toAiRequestMetadata(request),
    };
    // toJobStatus is what both GET /jobs/:id and every SSE event serialize.
    const publicView = JSON.stringify(toJobStatus(job));
    expect(publicView).not.toContain(secret);
    expect(publicView).not.toContain('"context"');
    // The result endpoint echoes job.request, which is where it stays visible.
    expect(JSON.stringify(job.request)).toContain(secret);
  });

  it('preview and submit use one request object', () => {
    const input = draft({ contextJson: '{"k":1}', ...allOptions });
    const preview = buildAiJobRequest(input);
    const submitted = buildAiJobRequest({ ...input });
    expect(preview).toEqual(submitted);
    expect(JSON.stringify(preview)).toBe(JSON.stringify(submitted));
  });
});
