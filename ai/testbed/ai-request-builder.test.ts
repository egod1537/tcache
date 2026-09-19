import { describe, expect, it } from 'vitest';

import { createAiCacheKey } from '../server/cache/key';
import { toGeminiRequest } from '../server/providers/gemini/mapper';
import { toOpenWebUIRequest } from '../server/providers/openwebui/mapper';
import { normalizeAiRequest } from '../server/types/ai';
import {
  buildAiJobRequest,
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
