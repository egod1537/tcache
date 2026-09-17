import type { NormalizedAiRequest } from '../../types/ai.js';
import type { OpenWebUIChatRequest } from './types.js';

export function toOpenWebUIRequest(
  request: NormalizedAiRequest,
): OpenWebUIChatRequest {
  return {
    ...request.options,
    model: request.model,
    messages: [
      ...(request.systemPrompt
        ? [{ role: 'system', content: request.systemPrompt }]
        : []),
      ...request.messages.map((message) => ({
        role:
          message.role === 'model'
            ? 'assistant'
            : message.role === 'assistant'
              ? 'assistant'
              : message.role,
        content: message.content,
      })),
    ],
    stream: false,
  };
}
