import { describe, expect, it } from 'vitest';

import { createAiCacheKey } from '../server/cache/key';
import { toJobStatus, type AiJob } from '../server/jobs/ai-job';
import { toGeminiRequest } from '../server/providers/gemini/mapper';
import { toOpenWebUIRequest } from '../server/providers/openwebui/mapper';
import { normalizeAiRequest, toAiRequestMetadata } from '../server/types/ai';
import {
  buildAiJobRequest,
  CONTEXT_MESSAGE_PREFIX,
  topPOptionKey,
  type AiRequestDraft,
} from './ai-request-builder';

const draft = (overrides: Partial<AiRequestDraft> = {}): AiRequestDraft => ({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  systemPrompt: 'You are a concise assistant.',
  userPrompt: ' Summarize the cache status. ',
  promptVersion: 'v1',
  temperature: '0.2',
  topP: '',
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
        cacheEnabled: false,
      }),
    ).toEqual({
      messages: [{ role: 'user', content: 'Summarize the cache status.' }],
      options: {},
      cache: { enabled: false },
    });
  });

  it('builds temperature and top-P with provider-native option names', () => {
    expect(
      build({ provider: 'gemini', temperature: '0.7', topP: '0.9' }),
    ).toMatchObject({ options: { temperature: 0.7, topP: 0.9 } });
    expect(
      build({
        provider: 'openwebui',
        model: 'qwen-test',
        temperature: '0.7',
        topP: '0.9',
      }),
    ).toMatchObject({ options: { temperature: 0.7, top_p: 0.9 } });
    expect(topPOptionKey('')).toBeUndefined();
  });

  it('accepts the range boundaries', () => {
    expect(build({ temperature: '0', topP: '0' })).toMatchObject({
      options: { temperature: 0, topP: 0 },
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
  ])('rejects invalid numeric input %j', (overrides, message) => {
    expect(buildError(overrides)).toBe(message);
  });

  it('requires an explicit provider to set Top-P', () => {
    expect(buildError({ provider: '', topP: '0.5' })).toMatch(
      /Select a provider to set Top-P/,
    );
    expect(build({ provider: '', topP: '' })).toBeTruthy();
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
});

describe('Top-P reaches each provider request shape', () => {
  it('Gemini: generationConfig.topP', () => {
    const request = normalizeAiRequest(
      build({ provider: 'gemini', temperature: '0.3', topP: '0.9' }),
    );
    expect(request.options).toEqual({ temperature: 0.3, topP: 0.9 });
    const wire = toGeminiRequest(request);
    expect(wire.generationConfig).toEqual({ temperature: 0.3, topP: 0.9 });
    expect(wire.systemInstruction).toEqual({
      parts: [{ text: 'You are a concise assistant.' }],
    });
    expect(wire.contents).toEqual([
      { role: 'user', parts: [{ text: 'Summarize the cache status.' }] },
    ]);
  });

  it('OpenWebUI: top-level top_p', () => {
    const request = normalizeAiRequest(
      build({
        provider: 'openwebui',
        model: 'qwen-test',
        temperature: '0.3',
        topP: '0.9',
      }),
    );
    const wire = toOpenWebUIRequest(request);
    expect(wire).toMatchObject({
      model: 'qwen-test',
      stream: false,
      temperature: 0.3,
      top_p: 0.9,
      messages: [
        { role: 'system', content: 'You are a concise assistant.' },
        { role: 'user', content: 'Summarize the cache status.' },
      ],
    });
    expect(wire).not.toHaveProperty('topP');
  });

  it('omits top-P from both provider requests when it is empty', () => {
    const gemini = toGeminiRequest(
      normalizeAiRequest(build({ provider: 'gemini' })),
    );
    expect(gemini.generationConfig).toEqual({ temperature: 0.2 });
    const openWebUI = toOpenWebUIRequest(
      normalizeAiRequest(build({ provider: 'openwebui', model: 'qwen-test' })),
    );
    expect(openWebUI).not.toHaveProperty('top_p');
    expect(openWebUI).not.toHaveProperty('topP');
  });

  it('changes the cache key so a Top-P change cannot hit a stale entry', () => {
    const key = (topP: string) =>
      createAiCacheKey(normalizeAiRequest(build({ topP })));
    expect(key('0.9')).not.toBe(key('0.5'));
    expect(key('0.9')).not.toBe(key(''));
  });
});

describe('Context JSON composition (Testbed only)', () => {
  const contextMessage = (json: string) => ({
    role: 'user',
    content: `${CONTEXT_MESSAGE_PREFIX}${json}`,
  });
  const promptMessage = { role: 'user', content: 'Create a short itinerary.' };

  it('leaves the request byte-identical when Context JSON is empty', () => {
    const base = draft({ userPrompt: 'Create a short itinerary.' });
    const withoutField = buildAiJobRequest(base);
    for (const contextJson of ['', '   ', '\n\t ']) {
      const result = buildAiJobRequest({ ...base, contextJson });
      expect(JSON.stringify(result)).toBe(JSON.stringify(withoutField));
    }
    expect(build({ userPrompt: 'Create a short itinerary.' })).toMatchObject({
      messages: [promptMessage],
    });
  });

  it('renders an object as one explicit user message before the prompt', () => {
    const messages = (
      build({
        userPrompt: 'Create a short itinerary.',
        contextJson: '{"destination":"Tokyo","days":3}',
      }) as { messages: unknown[] }
    ).messages;
    expect(messages).toEqual([
      {
        role: 'user',
        content: 'Context JSON:\n{\n  "destination": "Tokyo",\n  "days": 3\n}',
      },
      promptMessage,
    ]);
  });

  it('accepts arrays and primitive JSON values', () => {
    const first = (contextJson: string) =>
      (
        build({
          userPrompt: 'Create a short itinerary.',
          contextJson,
        }) as { messages: unknown[] }
      ).messages[0];
    expect(first('[1,{"a":true}]')).toEqual(
      contextMessage('[\n  1,\n  {\n    "a": true\n  }\n]'),
    );
    expect(first('"plain text"')).toEqual(contextMessage('"plain text"'));
    expect(first('42')).toEqual(contextMessage('42'));
    expect(first('true')).toEqual(contextMessage('true'));
    expect(first('null')).toEqual(contextMessage('null'));
  });

  it('blocks request creation on invalid JSON', () => {
    const error = buildError({ contextJson: '{"destination": ' });
    expect(error).toMatch(/^Context JSON must be valid JSON/);
    expect(buildAiJobRequest(draft({ contextJson: "{'a':1}" })).ok).toBe(false);
  });

  it('places the context message before Raw messages JSON, unchanged', () => {
    const raw = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' },
    ];
    expect(
      (
        build({
          contextJson: '{"k":1}',
          rawMessages: JSON.stringify(raw),
          userPrompt: 'ignored while raw messages are set',
        }) as { messages: unknown[] }
      ).messages,
    ).toEqual([contextMessage('{\n  "k": 1\n}'), ...raw]);
  });

  it('still requires a User Prompt or raw messages', () => {
    expect(buildError({ contextJson: '{"k":1}', userPrompt: ' ' })).toBe(
      'User Prompt is required.',
    );
  });

  it('does not change provider, model, options, cache or system prompt', () => {
    const base = draft({
      provider: 'openwebui',
      model: 'qwen-test',
      topP: '0.5',
    });
    const plain = build({
      provider: 'openwebui',
      model: 'qwen-test',
      topP: '0.5',
    });
    const withContext = build({
      provider: 'openwebui',
      model: 'qwen-test',
      topP: '0.5',
      contextJson: '{"k":1}',
      cacheEnabled: base.cacheEnabled,
    });
    const { messages: plainMessages, ...plainRest } = plain as {
      messages: unknown[];
    };
    const { messages: contextMessages, ...contextRest } = withContext as {
      messages: unknown[];
    };
    expect(contextRest).toEqual(plainRest);
    expect(contextRest).not.toHaveProperty('context');
    expect(contextMessages).toEqual([
      contextMessage('{\n  "k": 1\n}'),
      ...plainMessages,
    ]);
    expect(JSON.stringify(contextRest)).not.toContain('Context JSON');
  });

  it('is accepted unchanged by normalizeAiRequest and reaches provider requests as messages', () => {
    const request = build({
      provider: 'openwebui',
      model: 'qwen-test',
      userPrompt: 'Create a short itinerary.',
      contextJson: '{"destination":"Tokyo"}',
    });
    const normalized = normalizeAiRequest(request);
    expect(normalized.messages).toEqual(
      (request as { messages: unknown[] }).messages,
    );
    expect(normalized).not.toHaveProperty('context');
    expect(toOpenWebUIRequest(normalized).messages).toEqual([
      { role: 'system', content: 'You are a concise assistant.' },
      ...(request as { messages: unknown[] }).messages,
    ]);
    const gemini = toGeminiRequest(
      normalizeAiRequest({ ...request, provider: 'gemini' }),
    );
    expect(gemini.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Context JSON:\n{\n  "destination": "Tokyo"\n}' }],
    });
  });

  it('changes promptHash and the cache key because context is part of messages', () => {
    const normalize = (contextJson: string) =>
      normalizeAiRequest(build({ contextJson }));
    const none = normalize('');
    const a = normalize('{"k":1}');
    const b = normalize('{"k":2}');
    const hash = (r: typeof none) => toAiRequestMetadata(r).promptHash;
    expect(hash(a)).not.toBe(hash(none));
    expect(hash(a)).not.toBe(hash(b));
    expect(createAiCacheKey(a)).not.toBe(createAiCacheKey(none));
    expect(createAiCacheKey(a)).not.toBe(createAiCacheKey(b));
    // Formatting-only differences render to the same message, so they share a key.
    expect(createAiCacheKey(normalize('{ "k" :   1 }'))).toBe(
      createAiCacheKey(a),
    );
    expect(toAiRequestMetadata(a).messageCount).toBe(2);
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
    expect(publicView).not.toContain('Context JSON');
    // The result endpoint echoes job.request, which is where it stays visible.
    expect(JSON.stringify(job.request)).toContain(secret);
  });

  it('preview and submit use one request object', () => {
    const input = draft({ contextJson: '{"k":1}', topP: '0.5' });
    const preview = buildAiJobRequest(input);
    const submitted = buildAiJobRequest({ ...input });
    expect(preview).toEqual(submitted);
    expect(JSON.stringify(preview)).toBe(JSON.stringify(submitted));
  });
});
