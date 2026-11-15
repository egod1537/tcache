import type { NormalizedAiRequest } from '../../types/ai.js';
import { contextMessages } from '../context.js';
import type { OpenWebUIChatRequest } from './types.js';

export function toOpenWebUIRequest(
  request: NormalizedAiRequest,
): OpenWebUIChatRequest {
  const { temperature, topP, maxOutputTokens, stopSequences } = request.options;
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
    ...(stopSequences?.length ? { stop: stopSequences } : {}),
    model: request.model,
    messages: [
      ...(request.systemPrompt
        ? [{ role: 'system', content: request.systemPrompt }]
        : []),
      ...[...contextMessages(request.context), ...request.messages].map(
        (message) => ({
          role:
            message.role === 'model'
              ? 'assistant'
              : message.role === 'assistant'
                ? 'assistant'
                : message.role,
          content: message.content,
        }),
      ),
    ],
    stream: false,
  };
}
