import type { NormalizedAiRequest } from '../../types/ai.js';
import type { AiProvider, AiProviderResult } from '../provider.js';

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  supports() {
    return true;
  }

  async generate(
    request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    await delay(500, signal);
    return {
      provider: this.name,
      model: request.model,
      result: {
        text: `Mock response for ${request.messages.length} message(s)`,
        finishReason: 'STOP',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
  }
}
