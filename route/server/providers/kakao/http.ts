import {
  createKakaoHttpError,
  createKakaoNetworkError,
  KakaoRouteProviderError,
} from './errors.js';
import type { KakaoRequestSpec, KakaoRouteResult } from './types.js';

type KakaoProviderName = KakaoRouteResult['provider'];

export async function requestKakaoRoute(
  provider: KakaoProviderName,
  apiKey: string,
  request: KakaoRequestSpec,
  signal: AbortSignal,
): Promise<unknown> {
  if (!apiKey) {
    throw new KakaoRouteProviderError(
      'ROUTE_PROVIDER_AUTH_ERROR',
      'Kakao route provider API key is not configured',
      { provider, httpStatus: null, status: 'NOT_CONFIGURED' },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${request.url}?${request.query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    throw createKakaoNetworkError(provider, error);
  }

  let body: unknown;
  try {
    body = await readBody(response);
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    throw createKakaoNetworkError(provider, error);
  }
  if (!response.ok) {
    throw createKakaoHttpError(provider, response.status, body);
  }
  return body;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
