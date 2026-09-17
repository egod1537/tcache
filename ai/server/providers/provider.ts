import type { NormalizedAiRequest } from '../types/ai.js';
import type { AiJobError } from '../jobs/ai-job.js';

export interface AiProviderResult {
  provider: string;
  model: string;
  result: unknown;
}

export interface AiProvider {
  readonly name: string;
  supports(model: string): boolean;
  generate(
    request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult>;
}

export class AiProviderSelectionError extends Error {
  constructor(
    readonly code: Extract<
      AiJobError['code'],
      'PROVIDER_NOT_SUPPORTED' | 'MODEL_NOT_SUPPORTED'
    >,
    message: string,
  ) {
    super(message);
  }
}

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();

  constructor(providers: AiProvider[]) {
    for (const provider of providers)
      this.providers.set(provider.name, provider);
  }

  select(providerName: string, model: string): AiProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new AiProviderSelectionError(
        'PROVIDER_NOT_SUPPORTED',
        `AI provider is not enabled: ${providerName}`,
      );
    }
    if (!provider.supports(model)) {
      throw new AiProviderSelectionError(
        'MODEL_NOT_SUPPORTED',
        `Model ${model} is not supported by provider ${providerName}`,
      );
    }
    return provider;
  }
}
