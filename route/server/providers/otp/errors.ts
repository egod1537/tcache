export const OTP_ROUTE_ERROR_CODES = [
  'PROVIDER_NOT_CONFIGURED',
  'ROUTE_PROVIDER_TIMEOUT',
  'ROUTE_PROVIDER_BAD_REQUEST',
  'ROUTE_PROVIDER_NO_ROUTE',
  'ROUTE_PROVIDER_UNAVAILABLE',
  'ROUTE_PROVIDER_INVALID_DATA',
] as const;

export type OtpRouteErrorCode = (typeof OTP_ROUTE_ERROR_CODES)[number];

export class OtpRouteProviderError extends Error {
  constructor(
    readonly code: OtpRouteErrorCode,
    message: string,
    readonly details: {
      provider: 'otp';
      httpStatus: number | null;
      status: string | null;
    },
    readonly debug?: { upstreamMessage: string | null },
  ) {
    super(message);
    this.name = 'OtpRouteProviderError';
  }
}

export function createOtpHttpError(httpStatus: number, body: unknown) {
  const code: OtpRouteErrorCode =
    httpStatus === 408 || httpStatus === 504
      ? 'ROUTE_PROVIDER_TIMEOUT'
      : httpStatus >= 500
        ? 'ROUTE_PROVIDER_UNAVAILABLE'
        : 'ROUTE_PROVIDER_BAD_REQUEST';
  return error(code, httpStatus, `HTTP_${httpStatus}`, messageFrom(body));
}

export function createOtpGraphqlError(value: unknown) {
  const errors = Array.isArray(record(value)?.errors)
    ? (record(value)?.errors as unknown[])
    : [];
  const first = record(errors[0]);
  const status = text(record(first?.extensions)?.code) ?? 'GRAPHQL_ERROR';
  const code: OtpRouteErrorCode = /INTERNAL|UNAVAILABLE/i.test(status)
    ? 'ROUTE_PROVIDER_UNAVAILABLE'
    : 'ROUTE_PROVIDER_BAD_REQUEST';
  return error(code, 200, status, text(first?.message));
}

export function createOtpRoutingError(
  status: string,
  upstreamMessage: string | null,
) {
  const code: OtpRouteErrorCode = /NO_|SERVICE_PERIOD|NOT_FOUND/i.test(status)
    ? 'ROUTE_PROVIDER_NO_ROUTE'
    : 'ROUTE_PROVIDER_BAD_REQUEST';
  return error(code, 200, status, upstreamMessage);
}

export function createOtpNoRouteError() {
  return error('ROUTE_PROVIDER_NO_ROUTE', 200, 'NO_ROUTE', null);
}

export function createOtpInvalidDataError(upstreamMessage: string) {
  return error(
    'ROUTE_PROVIDER_INVALID_DATA',
    200,
    'INVALID_DATA',
    upstreamMessage,
  );
}

export function createOtpNetworkError(errorValue: unknown) {
  return error(
    'ROUTE_PROVIDER_UNAVAILABLE',
    null,
    'UNAVAILABLE',
    errorValue instanceof Error ? errorValue.message : null,
  );
}

export function createOtpTimeoutError(timeoutMs: number) {
  return error(
    'ROUTE_PROVIDER_TIMEOUT',
    null,
    'TIMEOUT',
    `OTP exceeded ${timeoutMs}ms timeout`,
  );
}

function error(
  code: OtpRouteErrorCode,
  httpStatus: number | null,
  status: string,
  upstreamMessage: string | null,
) {
  const messages: Record<OtpRouteErrorCode, string> = {
    PROVIDER_NOT_CONFIGURED: 'OTP route provider is not configured',
    ROUTE_PROVIDER_TIMEOUT: 'OTP route provider timed out',
    ROUTE_PROVIDER_BAD_REQUEST: 'OTP route provider rejected the request',
    ROUTE_PROVIDER_NO_ROUTE: 'OTP route provider found no route',
    ROUTE_PROVIDER_UNAVAILABLE: 'OTP route provider is unavailable',
    ROUTE_PROVIDER_INVALID_DATA: 'OTP route provider returned invalid data',
  };
  return new OtpRouteProviderError(
    code,
    messages[code],
    { provider: 'otp', httpStatus, status },
    { upstreamMessage },
  );
}

function messageFrom(body: unknown) {
  if (typeof body === 'string') return body;
  return text(record(body)?.message);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
