import type { AiMessage } from '../types/ai.js';

/** Map already-normalized caller context to an ordinary leading message. */
export function contextMessages(context: unknown): AiMessage[] {
  return context === undefined
    ? []
    : [
        {
          role: 'user',
          content: `Context JSON:\n${JSON.stringify(context, null, 2)}`,
        },
      ];
}
