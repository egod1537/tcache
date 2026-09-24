export const KAKAO_ROUTE_ERROR_CODES = [
  'ROUTE_PROVIDER_AUTH_ERROR',
  'ROUTE_PROVIDER_RATE_LIMITED',
  'ROUTE_PROVIDER_TIMEOUT',
  'ROUTE_PROVIDER_BAD_REQUEST',
  'ROUTE_PROVIDER_UNAVAILABLE',
] as const;

export type KakaoRouteErrorCode = (typeof KAKAO_ROUTE_ERROR_CODES)[number];

export interface KakaoRouteErrorDetails {
  provider: 'kakao-mobility' | 'kakao-maps';
  httpStatus: number | null;
  status: string | null;
}

export class KakaoRouteProviderError extends Error {
  constructor(
    readonly code: KakaoRouteErrorCode,
    message: string,
    readonly details: KakaoRouteErrorDetails,
    readonly debug?: { upstreamMessage: string | null },
  ) {
    super(message);
    this.name = 'KakaoRouteProviderError';
  }
}

export function createKakaoHttpError(
  provider: KakaoRouteErrorDetails['provider'],
  httpStatus: number,
  body: unknown,
) {
  const status = upstreamStatus(body);
  const upstreamMessage = upstreamMessageFrom(body);
  const code: KakaoRouteErrorCode =
    httpStatus === 401 || httpStatus === 403
      ? 'ROUTE_PROVIDER_AUTH_ERROR'
      : httpStatus === 429
        ? 'ROUTE_PROVIDER_RATE_LIMITED'
        : httpStatus === 408 || httpStatus === 504
          ? 'ROUTE_PROVIDER_TIMEOUT'
          : httpStatus >= 500
            ? 'ROUTE_PROVIDER_UNAVAILABLE'
            : 'ROUTE_PROVIDER_BAD_REQUEST';
  const messages: Record<KakaoRouteErrorCode, string> = {
    ROUTE_PROVIDER_AUTH_ERROR: 'Kakao route provider authentication failed',
    ROUTE_PROVIDER_RATE_LIMITED: 'Kakao route provider rate limit exceeded',
    ROUTE_PROVIDER_TIMEOUT: 'Kakao route provider timed out',
    ROUTE_PROVIDER_BAD_REQUEST: 'Kakao route provider rejected the request',
    ROUTE_PROVIDER_UNAVAILABLE: 'Kakao route provider is unavailable',
  };
  return new KakaoRouteProviderError(
    code,
    messages[code],
    { provider, httpStatus, status },
    { upstreamMessage },
  );
}

export function createKakaoResponseError(
  provider: KakaoRouteErrorDetails['provider'],
  status: string,
) {
  const badRequest = [
    'INVALID_REQUEST',
    'EQUAL_POINTS',
    'SAME_POINT',
    'STARTNODES_NULL',
    'ENDNODES_NULL',
    'START_LINK_NOT_FOUND',
    'END_LINK_NOT_FOUND',
    'TOO_FAR_AWAY',
  ].includes(status);
  return new KakaoRouteProviderError(
    badRequest ? 'ROUTE_PROVIDER_BAD_REQUEST' : 'ROUTE_PROVIDER_UNAVAILABLE',
    badRequest
      ? 'Kakao route provider rejected the request'
      : 'Kakao route provider returned no route',
    { provider, httpStatus: 200, status },
  );
}

export function createKakaoNetworkError(
  provider: KakaoRouteErrorDetails['provider'],
  error: unknown,
) {
  return new KakaoRouteProviderError(
    'ROUTE_PROVIDER_UNAVAILABLE',
    'Unable to reach Kakao route provider',
    { provider, httpStatus: null, status: 'UNAVAILABLE' },
    { upstreamMessage: error instanceof Error ? error.message : null },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function upstreamStatus(body: unknown) {
  const value = record(body);
  const error = record(value?.error);
  const status = error?.status ?? value?.status ?? value?.code;
  return typeof status === 'string' || typeof status === 'number'
    ? String(status)
    : null;
}

function upstreamMessageFrom(body: unknown) {
  const value = record(body);
  const error = record(value?.error);
  const message = error?.message ?? value?.message ?? value?.msg;
  return typeof message === 'string' ? message : null;
}
