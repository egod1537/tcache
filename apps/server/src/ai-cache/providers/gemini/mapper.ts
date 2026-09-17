import type { NormalizedAiRequest } from '../../types/ai.js';
import type { GeminiGenerateRequest } from './types.js';

export function toGeminiRequest(
  request: NormalizedAiRequest,
): GeminiGenerateRequest {
  const generationConfig: Record<string, unknown> = { ...request.options };
  if (request.responseSchema !== undefined) {
    generationConfig.responseSchema = request.responseSchema;
  }

  return {
    contents: request.messages.map((message) => ({
      role:
        message.role === 'assistant' || message.role === 'model'
          ? 'model'
          : 'user',
      parts: [{ text: message.content }],
    })),
    ...(request.systemPrompt
      ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(request.tools?.length ? { tools: request.tools } : {}),
  };
}
