import type { NormalizedAiRequest } from '../../types/ai.js';
import type { AiProvider, AiProviderResult } from '../provider.js';
import { toOpenWebUIRequest } from './mapper.js';
import type { OpenWebUIChatResponse } from './types.js';

export class OpenWebUIUnavailableError extends Error {
  readonly code = 'OPENWEBUI_UNAVAILABLE';
}

export function openWebUIHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function openWebUIUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    throw new OpenWebUIUnavailableError('OPENWEBUI_BASE_URL is not configured');
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export async function openWebUIErrorMessage(
  response: Response,
  operation: string,
  secret = '',
  includeDetail = true,
): Promise<string> {
  if (!includeDetail) {
    void response.body?.cancel().catch(() => {});
    return `OpenWebUI ${operation} failed with HTTP ${response.status}`;
  }
  let detail = '';
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'string') detail = body;
    else if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const candidate = record.detail ?? record.message ?? record.error;
      if (typeof candidate === 'string') detail = candidate;
      else if (candidate && typeof candidate === 'object') {
        const message = (candidate as Record<string, unknown>).message;
        if (typeof message === 'string') detail = message;
      }
    }
  } catch {
    // An empty or non-JSON upstream error still has a useful HTTP status.
  }
  const safeDetail = secret ? detail.replaceAll(secret, '[REDACTED]') : detail;
  const suffix = safeDetail ? `: ${safeDetail.slice(0, 500)}` : '';
  return `OpenWebUI ${operation} failed with HTTP ${response.status}${suffix}`;
}

export class OpenWebUIAiProvider implements AiProvider {
  readonly name = 'openwebui';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey = '',
  ) {}

  supports(model: string) {
    return Boolean(model.trim());
  }

  async generate(
    request: NormalizedAiRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    const response = await fetch(
      openWebUIUrl(this.baseUrl, '/api/chat/completions'),
      {
        method: 'POST',
        headers: openWebUIHeaders(this.apiKey),
        body: JSON.stringify(toOpenWebUIRequest(request)),
        signal,
      },
    );
    if (!response.ok) {
      // Upstream chat errors can echo prompts, so they must not reach Job/SSE.
      throw new OpenWebUIUnavailableError(
        await openWebUIErrorMessage(
          response,
          'chat request',
          this.apiKey,
          false,
        ),
      );
    }
    return {
      provider: this.name,
      model: request.model,
      result: (await response.json()) as OpenWebUIChatResponse,
    };
  }
}
