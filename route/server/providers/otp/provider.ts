import type { NormalizedRouteRequest } from '../../types/route.js';
import { validateRouteRequestForProvider } from '../location-validation.js';
import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderResult,
} from '../provider.js';
import {
  createOtpHttpError,
  createOtpNetworkError,
  createOtpTimeoutError,
  OtpRouteProviderError,
} from './errors.js';
import {
  DEFAULT_OTP_BASE_URL,
  OTP_MAX_LOCATIONS,
  toOtpTransitRequest,
} from './mapper.js';
import { parseOtpTransitResponse } from './parser.js';
import type { OtpDatasetIdentity } from './types.js';

export interface OtpRouteProviderOptions extends OtpDatasetIdentity {
  baseUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  otpVersion?: string;
}

export class OtpRouteProvider implements RouteProvider {
  readonly providerName = 'otp';
  readonly adapterVersion = '1';
  readonly experimental = true;
  readonly capabilities: RouteProviderCapabilities = {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: false,
    maxLocations: OTP_MAX_LOCATIONS,
    requiresCoordinates: true,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  };
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly cacheKeySeed?: string;
  readonly cacheMetadata?: Record<string, string>;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly datasetIdentity: OtpDatasetIdentity;

  constructor(options: OtpRouteProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OTP_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.available = options.enabled === true;
    if (!this.available) {
      this.unavailableReason = 'OTP_PROVIDER_ENABLED is false';
    }
    this.datasetIdentity = compactIdentity(options);
    const metadata = {
      ...(options.otpVersion ? { otpVersion: options.otpVersion } : {}),
      ...this.datasetIdentity,
    };
    if (Object.keys(metadata).length) {
      this.cacheMetadata = metadata;
      this.cacheKeySeed = JSON.stringify(metadata);
    }
  }

  getDebugRequest(request: NormalizedRouteRequest) {
    this.requireConfigured();
    return debugRequest(toOtpTransitRequest(request, this.baseUrl));
  }

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    this.requireConfigured();
    validateRouteRequestForProvider(request, this.providerName);
    const upstreamRequest = toOtpTransitRequest(request, this.baseUrl);
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, this.timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);

    try {
      const response = await this.fetchImpl(upstreamRequest.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Language': upstreamRequest.language,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamRequest.body),
        signal: combinedSignal,
      });
      const body = await readBody(response);
      if (!response.ok) throw createOtpHttpError(response.status, body);
      return {
        provider: this.providerName,
        result: parseOtpTransitResponse(body, this.datasetIdentity),
        debug: {
          providerRequest: debugRequest(upstreamRequest),
          rawProviderResponse: body,
        },
      };
    } catch (error) {
      if (error instanceof OtpRouteProviderError) throw error;
      if (timedOut) throw createOtpTimeoutError(this.timeoutMs);
      if (signal.aborted) throw signal.reason ?? error;
      throw createOtpNetworkError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDiagnostics(): Promise<Record<string, unknown>> {
    const common = {
      provider: this.providerName,
      configured: this.available,
      endpoint: this.baseUrl,
      experimental: true,
      ...this.cacheMetadata,
    };
    if (!this.available) return { ...common, reachable: false };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(this.timeoutMs, 5_000),
    );
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/otp/actuators/health`,
        { signal: controller.signal },
      );
      return { ...common, reachable: response.ok };
    } catch {
      return { ...common, reachable: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireConfigured() {
    if (this.available) return;
    throw new OtpRouteProviderError(
      'PROVIDER_NOT_CONFIGURED',
      'OTP route provider is not configured',
      { provider: 'otp', httpStatus: null, status: 'NOT_CONFIGURED' },
    );
  }
}

function debugRequest(request: ReturnType<typeof toOtpTransitRequest>) {
  return {
    method: 'POST',
    url: request.url,
    headers: {
      Accept: 'application/json',
      'Accept-Language': request.language,
    },
    operationName: request.body.operationName,
    query: request.body.query,
    variables: request.body.variables,
  };
}

function compactIdentity(options: OtpRouteProviderOptions): OtpDatasetIdentity {
  return {
    ...(options.graphBuildId ? { graphBuildId: options.graphBuildId } : {}),
    ...(options.gtfsDatasetVersion
      ? { gtfsDatasetVersion: options.gtfsDatasetVersion }
      : {}),
    ...(options.osmDatasetVersion
      ? { osmDatasetVersion: options.osmDatasetVersion }
      : {}),
  };
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
