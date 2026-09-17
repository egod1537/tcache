import type { NormalizedAiRequest } from '../../types/ai.js';
import type { AiProvider, AiProviderResult } from '../provider.js';
import { toGeminiRequest } from './mapper.js';
import type { GeminiGenerateResponse } from './types.js';

export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(private readonly apiKey: string) {}

  supports(model: string) {
    return model.startsWith('gemini-');
  }

  async generate(
    request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const model = encodeURIComponent(request.model.replace(/^models\//, ''));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(toGeminiRequest(request)),
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini request failed with HTTP ${response.status}`);
    }
    return {
      provider: this.name,
      model: request.model,
      result: (await response.json()) as GeminiGenerateResponse,
    };
  }
}
