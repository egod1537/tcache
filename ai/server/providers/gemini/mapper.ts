import type { NormalizedAiRequest } from '../../types/ai.js';
import { contextMessages } from '../context.js';
import type { GeminiGenerateRequest } from './types.js';

export function toGeminiRequest(
  request: NormalizedAiRequest,
): GeminiGenerateRequest {
  const { temperature, topP, maxOutputTokens, stopSequences } = request.options;
  const generationConfig: Record<string, unknown> = {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(stopSequences?.length ? { stopSequences } : {}),
  };
  if (request.responseSchema !== undefined) {
    generationConfig.responseSchema = request.responseSchema;
  }

  return {
    contents: [...contextMessages(request.context), ...request.messages].map(
      (message) => ({
        role:
          message.role === 'assistant' || message.role === 'model'
            ? 'model'
            : 'user',
        parts: [{ text: message.content }],
      }),
    ),
    ...(request.systemPrompt
      ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(request.tools?.length ? { tools: request.tools } : {}),
  };
}
