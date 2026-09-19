export type AiProviderChoice = '' | 'gemini' | 'openwebui' | 'mock';

export interface AiRequestDraft {
  provider: AiProviderChoice;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
  temperature: string;
  topP: string;
  rawMessages: string;
  contextJson: string;
  cacheEnabled: boolean;
}

export type AiRequestBuildResult =
  { ok: true; request: Record<string, unknown> } | { ok: false; error: string };

/**
 * `options` is passed to each provider as-is (Gemini `generationConfig`,
 * OpenWebUI chat body), so the Top-P key is provider-native. The mock provider
 * ignores options; it uses the Gemini spelling.
 */
export const TOP_P_OPTION_KEYS = {
  gemini: 'topP',
  openwebui: 'top_p',
  mock: 'topP',
} as const;

export function topPOptionKey(provider: AiProviderChoice) {
  return provider ? TOP_P_OPTION_KEYS[provider] : undefined;
}

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

/** Prefix of the explicit message the Testbed builds from Context JSON. */
export const CONTEXT_MESSAGE_PREFIX = 'Context JSON:\n';

/**
 * Testbed-only request composition: Context JSON is not a backend field. It
 * becomes one ordinary, visible `user` message placed before all other
 * messages. Empty input adds nothing.
 */
function parseContextMessage(raw: string) {
  const text = raw.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Context JSON must be valid JSON${
        error instanceof Error ? `: ${error.message}` : '.'
      }`,
    );
  }
  return [
    {
      role: 'user',
      content: `${CONTEXT_MESSAGE_PREFIX}${JSON.stringify(parsed, null, 2)}`,
    },
  ];
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

/** Builds the exact body POSTed to /api/ai/jobs; empty optional values are omitted. */
export function buildAiJobRequest(draft: AiRequestDraft): AiRequestBuildResult {
  try {
    const messages = [
      ...parseContextMessage(draft.contextJson),
      ...parseMessages(draft),
    ];
    const temperature = parseOptionalNumber(
      draft.temperature,
      'Temperature',
      0,
      2,
    );
    const topP = parseOptionalNumber(draft.topP, 'Top-P', 0, 1);

    const topPKey = topPOptionKey(draft.provider);
    if (topP !== undefined && !topPKey) {
      throw new Error(
        'Select a provider to set Top-P. The option name is provider-specific (Gemini: topP, OpenWebUI: top_p).',
      );
    }

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
        options: {
          ...(temperature !== undefined ? { temperature } : {}),
          ...(topP !== undefined && topPKey ? { [topPKey]: topP } : {}),
        },
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
