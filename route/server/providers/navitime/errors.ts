export const NAVITIME_ROUTE_ERROR_CODES = [
  'ROUTE_PROVIDER_AUTH_ERROR',
  'ROUTE_PROVIDER_RATE_LIMITED',
  'ROUTE_PROVIDER_TIMEOUT',
  'ROUTE_PROVIDER_BAD_REQUEST',
  'ROUTE_PROVIDER_NO_ROUTE',
  'ROUTE_PROVIDER_UNAVAILABLE',
] as const;

export type NavitimeRouteErrorCode =
  (typeof NAVITIME_ROUTE_ERROR_CODES)[number];

export class NavitimeRouteProviderError extends Error {
  constructor(
    readonly code: NavitimeRouteErrorCode,
    message: string,
    readonly details: {
      provider: 'navitime';
      httpStatus: number | null;
      status: string | null;
    },
    readonly debug?: { upstreamMessage: string | null },
  ) {
    super(message);
    this.name = 'NavitimeRouteProviderError';
  }
}

export function createNavitimeHttpError(httpStatus: number, body: unknown) {
  const upstreamMessage = messageFrom(body);
  const noRoute =
    httpStatus === 404 ||
    /route (?:is )?not found|specified route is not found/i.test(
      upstreamMessage ?? '',
    );
  const code: NavitimeRouteErrorCode =
    httpStatus === 401 || httpStatus === 403
      ? 'ROUTE_PROVIDER_AUTH_ERROR'
      : httpStatus === 429
        ? 'ROUTE_PROVIDER_RATE_LIMITED'
        : httpStatus === 408 || httpStatus === 504
          ? 'ROUTE_PROVIDER_TIMEOUT'
          : noRoute
            ? 'ROUTE_PROVIDER_NO_ROUTE'
            : httpStatus >= 500
              ? 'ROUTE_PROVIDER_UNAVAILABLE'
              : 'ROUTE_PROVIDER_BAD_REQUEST';
  const messages: Record<NavitimeRouteErrorCode, string> = {
    ROUTE_PROVIDER_AUTH_ERROR: 'NAVITIME route provider authentication failed',
    ROUTE_PROVIDER_RATE_LIMITED: 'NAVITIME route provider rate limit exceeded',
    ROUTE_PROVIDER_TIMEOUT: 'NAVITIME route provider timed out',
    ROUTE_PROVIDER_BAD_REQUEST: 'NAVITIME route provider rejected the request',
    ROUTE_PROVIDER_NO_ROUTE: 'NAVITIME route provider found no route',
    ROUTE_PROVIDER_UNAVAILABLE: 'NAVITIME route provider is unavailable',
  };
  return new NavitimeRouteProviderError(
    code,
    messages[code],
    {
      provider: 'navitime',
      httpStatus,
      status: statusFrom(body),
    },
    { upstreamMessage },
  );
}

export function createNavitimeNoRouteError(status = 'NO_ROUTE') {
  return new NavitimeRouteProviderError(
    'ROUTE_PROVIDER_NO_ROUTE',
    'NAVITIME route provider found no route',
    { provider: 'navitime', httpStatus: 200, status },
  );
}

export function createNavitimeNetworkError(error: unknown) {
  return new NavitimeRouteProviderError(
    'ROUTE_PROVIDER_UNAVAILABLE',
    'Unable to reach NAVITIME route provider',
    { provider: 'navitime', httpStatus: null, status: 'UNAVAILABLE' },
    { upstreamMessage: error instanceof Error ? error.message : null },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messageFrom(body: unknown) {
  if (typeof body === 'string') return body;
  const value = record(body);
  return typeof value?.message === 'string' ? value.message : null;
}

function statusFrom(body: unknown) {
  const value = record(body);
  const status = value?.status_code ?? value?.status ?? value?.code;
  return typeof status === 'string' || typeof status === 'number'
    ? String(status)
    : null;
}
