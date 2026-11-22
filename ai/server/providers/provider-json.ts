function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOpenWebUICompletion(choice: unknown): boolean {
  const item = asRecord(choice);
  const message = asRecord(item?.message);
  const content = message?.content;
  return (
    hasText(item?.text) ||
    hasText(content) ||
    (Array.isArray(content) &&
      content.some((part) => hasText(asRecord(part)?.text))) ||
    hasText(message?.refusal) ||
    hasText(asRecord(message?.function_call)?.name) ||
    (Array.isArray(message?.tool_calls) &&
      message.tool_calls.some((call) =>
        hasText(asRecord(asRecord(call)?.function)?.name),
      ))
  );
}

function hasGeminiCompletion(candidate: unknown): boolean {
  const parts = asRecord(asRecord(candidate)?.content)?.parts;
  return (
    Array.isArray(parts) &&
    parts.some((value) => {
      const part = asRecord(value);
      return (
        hasText(part?.text) ||
        hasText(asRecord(part?.functionCall)?.name) ||
        hasText(asRecord(part?.inlineData)?.data) ||
        hasText(asRecord(part?.fileData)?.fileUri) ||
        hasText(asRecord(part?.executableCode)?.code) ||
        hasText(asRecord(part?.codeExecutionResult)?.output)
      );
    })
  );
}

export function isAiProviderResponse(
  provider: string,
  value: unknown,
): boolean {
  const response = asRecord(value);
  if (!response || 'error' in response) return false;

  switch (provider) {
    case 'openwebui':
      return (
        Array.isArray(response.choices) &&
        response.choices.some(hasOpenWebUICompletion)
      );
    case 'gemini':
      return (
        Array.isArray(response.candidates) &&
        response.candidates.some(hasGeminiCompletion)
      );
    case 'mock':
      return hasText(response.text);
    default:
      return true;
  }
}

/** Preserve diagnostic response structure without retaining provider credentials. */
export async function readProviderJson(
  response: Response,
  secret: string,
): Promise<unknown> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The AI provider returned invalid JSON');
    }
    throw error;
  }
  if (!secret) return value;

  function redact(input: unknown): unknown {
    if (typeof input === 'string')
      return input.replaceAll(secret, '[REDACTED]');
    if (Array.isArray(input)) return input.map(redact);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([key, child]) => [
          key.replaceAll(secret, '[REDACTED]'),
          redact(child),
        ]),
      );
    }
    return input;
  }
  return redact(value);
}
