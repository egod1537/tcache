import { canonicalJson, type AiMessage } from '../types/ai.js';

export const CONTEXT_MESSAGE_PREFIX = 'Context JSON:\n';

/**
 * Renders opaque request context as one leading `user` message. Keys are
 * canonicalized so the provider input is deterministic for equal contexts.
 */
export function contextMessages(context: unknown): AiMessage[] {
  if (context === undefined) return [];
  return [
    {
      role: 'user',
      content: `${CONTEXT_MESSAGE_PREFIX}${JSON.stringify(
        canonicalJson(context),
        null,
        2,
      )}`,
    },
  ];
}
