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
