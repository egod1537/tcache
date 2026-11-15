import type { AiGenerationOptions } from '../../apps/testbed/src/api/client';

export type AiProviderChoice = '' | 'gemini' | 'openwebui' | 'mock';

export interface AiRequestDraft {
  provider: AiProviderChoice;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
  temperature: string;
  topP: string;
  maxOutputTokens: string;
  /** One stop sequence per line; blank lines are ignored. */
  stopSequences: string;
  rawMessages: string;
  contextJson: string;
  cacheEnabled: boolean;
}

export type AiRequestBuildResult =
  { ok: true; request: Record<string, unknown> } | { ok: false; error: string };

function parseOptionalNumber(
  raw: string,
  label: string,
  min: number,
  max: number,
): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseOptionalPositiveInteger(
  raw: string,
  label: string,
): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function parseStopSequences(raw: string): string[] {
  return raw.split('\n').filter((line) => line.length > 0);
}

/**
 * Parses Context JSON into the request's `context` field. The backend keeps it
 * as opaque JSON and decides how it reaches each provider. Empty input omits
 * the field.
 */
function parseContext(raw: string): { context?: unknown } {
  const text = raw.trim();
  if (!text) return {};
  try {
    return { context: JSON.parse(text) as unknown };
  } catch (error) {
    throw new Error(
      `Context JSON must be valid JSON${
        error instanceof Error ? `: ${error.message}` : '.'
      }`,
    );
  }
}

function parseMessages(draft: AiRequestDraft) {
  if (draft.rawMessages.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft.rawMessages);
    } catch {
      throw new Error('Raw messages must be valid JSON.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Raw messages JSON must be an array.');
    }
    return parsed as Array<{ role: string; content: string }>;
  }
  if (!draft.userPrompt.trim()) throw new Error('User Prompt is required.');
  return [{ role: 'user', content: draft.userPrompt.trim() }];
}

/**
 * Builds the exact body POSTed to /api/ai/jobs; empty optional values are
 * omitted. Options always use canonical names regardless of provider.
 */
export function buildAiJobRequest(draft: AiRequestDraft): AiRequestBuildResult {
  try {
    const messages = parseMessages(draft);
    const context = parseContext(draft.contextJson);
    const temperature = parseOptionalNumber(
      draft.temperature,
      'Temperature',
      0,
      2,
    );
    const topP = parseOptionalNumber(draft.topP, 'Top-P', 0, 1);
    const maxOutputTokens = parseOptionalPositiveInteger(
      draft.maxOutputTokens,
      'Max output tokens',
    );
    const stopSequences = parseStopSequences(draft.stopSequences);
    const options: AiGenerationOptions = {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(stopSequences.length ? { stopSequences } : {}),
    };

    return {
      ok: true,
      request: {
        ...(draft.provider ? { provider: draft.provider } : {}),
        ...(draft.provider && draft.model.trim()
          ? { model: draft.model.trim() }
          : {}),
        ...(draft.systemPrompt ? { systemPrompt: draft.systemPrompt } : {}),
        ...(draft.promptVersion.trim()
          ? { promptVersion: draft.promptVersion.trim() }
          : {}),
        messages,
        ...context,
        options,
        cache: { enabled: draft.cacheEnabled },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid request.',
    };
  }
}
