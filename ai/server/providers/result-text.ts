function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

export function extractAiText(result: unknown): string | undefined {
  const root = record(result);
  if (!root) return undefined;
  if (typeof root.text === 'string') return root.text;
  const rootMessage = record(root.message);
  if (typeof rootMessage?.content === 'string') return rootMessage.content;

  const firstChoice = Array.isArray(root.choices)
    ? record(root.choices[0])
    : null;
  const choiceMessage = record(firstChoice?.message);
  if (typeof choiceMessage?.content === 'string') {
    return choiceMessage.content;
  }
  if (typeof firstChoice?.text === 'string') return firstChoice.text;

  const firstCandidate = Array.isArray(root.candidates)
    ? record(root.candidates[0])
    : null;
  const content = record(firstCandidate?.content);
  if (!Array.isArray(content?.parts)) return undefined;
  const parts = content.parts
    .map((part) => record(part)?.text)
    .filter((part): part is string => typeof part === 'string');
  return parts.length ? parts.join('') : undefined;
}
