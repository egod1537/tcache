export const EKISPERT_ROUTE_ERROR_CODES = [
  'PROVIDER_NOT_CONFIGURED',
  'ROUTE_PROVIDER_AUTH_ERROR',
  'ROUTE_PROVIDER_RATE_LIMITED',
  'ROUTE_PROVIDER_TIMEOUT',
  'ROUTE_PROVIDER_BAD_REQUEST',
  'ROUTE_PROVIDER_NO_ROUTE',
  'ROUTE_PROVIDER_UNAVAILABLE',
] as const;

export type EkispertRouteErrorCode =
  (typeof EKISPERT_ROUTE_ERROR_CODES)[number];

export class EkispertRouteProviderError extends Error {
  constructor(
    readonly code: EkispertRouteErrorCode,
    message: string,
    readonly details: {
      provider: 'ekispert';
      httpStatus: number | null;
      status: string | null;
    },
    readonly debug?: { upstreamMessage: string | null },
  ) {
    super(message);
    this.name = 'EkispertRouteProviderError';
  }
}

export function createEkispertHttpError(httpStatus: number, body: unknown) {
  const upstreamMessage = messageFrom(body);
  const noRoute =
    /no route|route not found|経路.*(?:なし|見つ)|探索結果.*(?:なし|0件)/i.test(
      upstreamMessage ?? '',
    );
  const code: EkispertRouteErrorCode =
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
  return new EkispertRouteProviderError(
    code,
    messageFor(code),
    {
      provider: 'ekispert',
      httpStatus,
      status: statusFrom(body),
    },
    { upstreamMessage },
  );
}

export function createEkispertResponseError(
  status: string,
  upstreamMessage: string | null = null,
) {
  const code: EkispertRouteErrorCode =
    /no route|route not found|経路.*(?:なし|見つか)|探索結果.*(?:なし|0件)/i.test(
      upstreamMessage ?? '',
    )
      ? 'ROUTE_PROVIDER_NO_ROUTE'
      : 'ROUTE_PROVIDER_BAD_REQUEST';
  return new EkispertRouteProviderError(
    code,
    messageFor(code),
    { provider: 'ekispert', httpStatus: 200, status },
    { upstreamMessage },
  );
}

export function createEkispertNetworkError(error: unknown) {
  return new EkispertRouteProviderError(
    'ROUTE_PROVIDER_UNAVAILABLE',
    messageFor('ROUTE_PROVIDER_UNAVAILABLE'),
    { provider: 'ekispert', httpStatus: null, status: 'UNAVAILABLE' },
    { upstreamMessage: error instanceof Error ? error.message : null },
  );
}

function messageFor(code: EkispertRouteErrorCode) {
  const messages: Record<EkispertRouteErrorCode, string> = {
    PROVIDER_NOT_CONFIGURED: 'Ekispert route provider is not configured',
    ROUTE_PROVIDER_AUTH_ERROR: 'Ekispert route provider authentication failed',
    ROUTE_PROVIDER_RATE_LIMITED: 'Ekispert route provider rate limit exceeded',
    ROUTE_PROVIDER_TIMEOUT: 'Ekispert route provider timed out',
    ROUTE_PROVIDER_BAD_REQUEST: 'Ekispert route provider rejected the request',
    ROUTE_PROVIDER_NO_ROUTE: 'Ekispert route provider found no route',
    ROUTE_PROVIDER_UNAVAILABLE: 'Ekispert route provider is unavailable',
  };
  return messages[code];
}

function messageFrom(body: unknown): string | null {
  if (typeof body === 'string') return body;
  const resultSet = record(record(body)?.ResultSet);
  const error = record(resultSet?.Error);
  const message = error?.Message ?? record(error?.Message)?.text;
  return typeof message === 'string' ? message : null;
}

function statusFrom(body: unknown): string | null {
  const resultSet = record(record(body)?.ResultSet);
  const error = record(resultSet?.Error);
  const status = error?.code;
  return typeof status === 'string' || typeof status === 'number'
    ? String(status)
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
