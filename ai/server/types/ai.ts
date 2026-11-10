import { createHash } from 'node:crypto';

export interface AiMessage {
  role: string;
  content: string;
}

/**
 * Provider-neutral generation options. Provider adapters translate these names
 * into their own wire format; clients never send provider-native keys.
 */
export interface AiGenerationOptions {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export const AI_GENERATION_OPTION_KEYS = [
  'temperature',
  'topP',
  'maxOutputTokens',
  'stopSequences',
] as const satisfies readonly (keyof AiGenerationOptions)[];

/** Any JSON value. tcache treats request context as opaque data. */
export type AiContext = unknown;

export interface AiJobRequest {
  provider: string;
  model: string;
  systemPrompt?: string;
  promptVersion?: string;
  messages: AiMessage[];
  /** Opaque caller-owned JSON, stored with object keys in canonical order. */
  context?: AiContext;
  options: AiGenerationOptions;
  tools?: unknown[];
  responseSchema?: unknown;
  cache: { enabled: boolean };
}

export type NormalizedAiRequest = AiJobRequest;

export interface AiRequestDefaults {
  provider: string;
  models: Partial<Record<string, string>>;
}

export interface AiRequestMetadata {
  provider: string;
  model: string;
  messageCount: number;
  promptHash: string;
  promptVersion?: string;
  hasSystemPrompt: boolean;
  hasContext: boolean;
  optionKeys: string[];
  toolCount: number;
  hasResponseSchema: boolean;
  cacheEnabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validates canonical option names, types and ranges. Unknown keys are
 * rejected so provider-native options can never reach an upstream silently.
 * Keys are emitted in a fixed order and an empty stopSequences is dropped.
 */
export function normalizeAiOptions(input: unknown): AiGenerationOptions {
  if (input === undefined) return {};
  if (!isRecord(input)) throw new Error('options must be an object');
  const known: readonly string[] = AI_GENERATION_OPTION_KEYS;
  const unknown = Object.keys(input).filter((key) => !known.includes(key));
  if (unknown.length) {
    throw new Error(
      `Unknown option(s): ${unknown.join(', ')}. Supported options: ${known.join(', ')}`,
    );
  }

  const options: AiGenerationOptions = {};
  if (input.temperature !== undefined) {
    options.temperature = finiteNumber(
      input.temperature,
      'options.temperature',
      0,
      2,
    );
  }
  if (input.topP !== undefined) {
    options.topP = finiteNumber(input.topP, 'options.topP', 0, 1);
  }
  if (input.maxOutputTokens !== undefined) {
    const value = input.maxOutputTokens;
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new Error('options.maxOutputTokens must be a positive integer');
    }
    options.maxOutputTokens = value as number;
  }
  if (input.stopSequences !== undefined) {
    const value = input.stopSequences;
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      throw new Error(
        'options.stopSequences must be an array of non-empty strings',
      );
    }
    if (value.length) options.stopSequences = [...(value as string[])];
  }
  return options;
}

/**
 * Returns the JSON value with object keys sorted, so contexts that differ only
 * in key order are stored, hashed and rendered identically. Array order is
 * meaningful and preserved.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

export function normalizeAiRequest(
  input: unknown,
  defaults?: AiRequestDefaults,
): NormalizedAiRequest {
  if (!isRecord(input)) throw new Error('Request body must be an object');
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const messages = input.messages.map((message, index) => {
    if (!isRecord(message))
      throw new Error(`messages[${index}] must be an object`);
    return {
      role: requiredString(
        message.role,
        `messages[${index}].role`,
      ).toLowerCase(),
      content: requiredString(message.content, `messages[${index}].content`),
    };
  });

  const options = normalizeAiOptions(input.options);
  if (input.cache !== undefined && !isRecord(input.cache)) {
    throw new Error('cache must be an object');
  }
  if (input.tools !== undefined && !Array.isArray(input.tools)) {
    throw new Error('tools must be an array');
  }
  const cacheEnabled = input.cache?.enabled;
  if (cacheEnabled !== undefined && typeof cacheEnabled !== 'boolean') {
    throw new Error('cache.enabled must be a boolean');
  }

  const requestedProvider =
    typeof input.provider === 'string' && !input.provider.trim()
      ? undefined
      : input.provider;
  const provider = requiredString(
    requestedProvider ?? defaults?.provider,
    'provider',
  ).toLowerCase();
  const requestedModel =
    typeof input.model === 'string' && !input.model.trim()
      ? undefined
      : input.model;
  const model = requiredString(
    requestedModel ?? defaults?.models[provider],
    `model (or the ${provider} provider default)`,
  );

  return {
    provider,
    model,
    ...(typeof input.systemPrompt === 'string'
      ? { systemPrompt: input.systemPrompt }
      : {}),
    ...(typeof input.promptVersion === 'string' && input.promptVersion.trim()
      ? { promptVersion: input.promptVersion.trim() }
      : {}),
    messages,
    ...(input.context !== undefined
      ? { context: canonicalJson(input.context) }
      : {}),
    options,
    ...(Array.isArray(input.tools) ? { tools: input.tools } : {}),
    ...(input.responseSchema !== undefined
      ? { responseSchema: input.responseSchema }
      : {}),
    cache: { enabled: cacheEnabled ?? true },
  };
}

export function toAiRequestMetadata(
  request: NormalizedAiRequest,
): AiRequestMetadata {
  const sensitiveInput = JSON.stringify({
    systemPrompt: request.systemPrompt ?? '',
    messages: request.messages,
    ...(request.context !== undefined ? { context: request.context } : {}),
  });
  return {
    provider: request.provider,
    model: request.model,
    messageCount: request.messages.length,
    promptHash: createHash('sha256').update(sensitiveInput).digest('hex'),
    ...(request.promptVersion ? { promptVersion: request.promptVersion } : {}),
    hasSystemPrompt: Boolean(request.systemPrompt),
    hasContext: request.context !== undefined,
    optionKeys: Object.keys(request.options).sort(),
    toolCount: request.tools?.length ?? 0,
    hasResponseSchema: request.responseSchema !== undefined,
    cacheEnabled: request.cache.enabled,
  };
}
