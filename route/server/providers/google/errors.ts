export interface GoogleRoutesErrorDetails {
  upstream: {
    httpStatus: number | null;
    status: string | null;
    message: string | null;
    requestBody?: unknown;
    rawErrorBody?: unknown;
  };
}

export class GoogleRoutesError extends Error {
  readonly code = 'GOOGLE_ROUTES_ERROR' as const;

  constructor(
    message: string,
    readonly details: GoogleRoutesErrorDetails,
  ) {
    super(message);
    this.name = 'GoogleRoutesError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createGoogleUpstreamError(
  httpStatus: number,
  body: unknown,
  requestBody: unknown,
) {
  const error = record(record(body)?.error);
  const status = typeof error?.status === 'string' ? error.status : null;
  const upstreamMessage =
    typeof error?.message === 'string' ? error.message : null;
  return new GoogleRoutesError(
    upstreamMessage ?? `Google Routes API returned HTTP ${httpStatus}`,
    {
      upstream: {
        httpStatus,
        status,
        message: upstreamMessage,
        requestBody,
        rawErrorBody: body,
      },
    },
  );
}
