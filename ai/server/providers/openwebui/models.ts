import {
  OpenWebUIUnavailableError,
  openWebUIErrorMessage,
  openWebUIHeaders,
  openWebUIUrl,
} from './client.js';
import type { OpenWebUIModel, OpenWebUIModelsResponse } from './types.js';

function asModel(value: unknown): OpenWebUIModel | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: value.trim(), name: value.trim() };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawId =
    typeof record.id === 'string'
      ? record.id
      : typeof record.model === 'string'
        ? record.model
        : '';
  if (!rawId.trim()) return null;
  const id = rawId.trim();
  const name =
    typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : id;
  return { id, name };
}

export function normalizeOpenWebUIModels(input: unknown): OpenWebUIModel[] {
  const response = input as OpenWebUIModelsResponse;
  const source = Array.isArray(input)
    ? input
    : Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.models)
        ? response.models
        : [];
  const unique = new Map<string, OpenWebUIModel>();
  for (const value of source) {
    const model = asModel(value);
    if (model) unique.set(model.id, model);
  }
  return [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export class OpenWebUIModelService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey = '',
    private readonly timeoutMs = 10_000,
  ) {}

  async list(signal?: AbortSignal): Promise<OpenWebUIModel[]> {
    let response: Response;
    try {
      response = await fetch(openWebUIUrl(this.baseUrl, '/api/models'), {
        headers: openWebUIHeaders(this.apiKey),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof OpenWebUIUnavailableError) throw error;
      throw new OpenWebUIUnavailableError(
        error instanceof Error
          ? `OpenWebUI model discovery failed: ${error.message}`
          : 'OpenWebUI model discovery failed',
      );
    }
    if (!response.ok) {
      throw new OpenWebUIUnavailableError(
        await openWebUIErrorMessage(response, 'model discovery', this.apiKey),
      );
    }
    try {
      return normalizeOpenWebUIModels(await response.json());
    } catch {
      throw new OpenWebUIUnavailableError(
        'OpenWebUI model discovery returned invalid JSON',
      );
    }
  }
}
