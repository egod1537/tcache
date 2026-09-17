import { createHash } from 'node:crypto';

export interface AiMessage {
  role: string;
  content: string;
}

export interface AiJobRequest {
  provider: string;
  model: string;
  systemPrompt?: string;
  promptVersion?: string;
  messages: AiMessage[];
  options: Record<string, unknown>;
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

  if (input.options !== undefined && !isRecord(input.options)) {
    throw new Error('options must be an object');
  }
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
    options: isRecord(input.options) ? input.options : {},
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
  });
  return {
    provider: request.provider,
    model: request.model,
    messageCount: request.messages.length,
    promptHash: createHash('sha256').update(sensitiveInput).digest('hex'),
    ...(request.promptVersion ? { promptVersion: request.promptVersion } : {}),
    hasSystemPrompt: Boolean(request.systemPrompt),
    optionKeys: Object.keys(request.options).sort(),
    toolCount: request.tools?.length ?? 0,
    hasResponseSchema: request.responseSchema !== undefined,
    cacheEnabled: request.cache.enabled,
  };
}
