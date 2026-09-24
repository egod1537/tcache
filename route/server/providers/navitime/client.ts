import type { NormalizedRouteRequest } from '../../types/route.js';
import { validateRouteRequestForProvider } from '../location-validation.js';
import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderResult,
} from '../provider.js';
import {
  createNavitimeHttpError,
  createNavitimeNetworkError,
  NavitimeRouteProviderError,
} from './errors.js';
import {
  DEFAULT_NAVITIME_API_BASE_URL,
  toNavitimeTransitRequest,
} from './mapper.js';
import { parseNavitimeTransitResponse } from './parser.js';

export class NavitimeRouteProvider implements RouteProvider {
  readonly providerName = 'navitime';
  readonly adapterVersion = '1';
  readonly capabilities: RouteProviderCapabilities = {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: true,
    maxLocations: 12,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  };

  constructor(
    private readonly apiKey: string,
    private readonly apiBaseUrl = DEFAULT_NAVITIME_API_BASE_URL,
  ) {}

  getDebugRequest(request: NormalizedRouteRequest) {
    return debugRequest(toNavitimeTransitRequest(request, this.apiBaseUrl));
  }

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    validateRouteRequestForProvider(request, this.providerName);
    if (!this.apiKey) {
      throw new NavitimeRouteProviderError(
        'ROUTE_PROVIDER_AUTH_ERROR',
        'NAVITIME_API_KEY is not configured',
        { provider: 'navitime', httpStatus: null, status: 'NOT_CONFIGURED' },
      );
    }
    const upstreamRequest = toNavitimeTransitRequest(request, this.apiBaseUrl);
    const url = new URL(upstreamRequest.url);
    url.search = upstreamRequest.query.toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': url.host,
        },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw createNavitimeNetworkError(error);
    }

    let body: unknown;
    try {
      body = await readBody(response);
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw createNavitimeNetworkError(error);
    }
    if (!response.ok) {
      throw createNavitimeHttpError(response.status, body);
    }
    return {
      provider: this.providerName,
      result: parseNavitimeTransitResponse(body),
      debug: {
        providerRequest: debugRequest(upstreamRequest),
        rawProviderResponse: body,
      },
    };
  }
}

function debugRequest(request: { url: string; query: URLSearchParams }) {
  return {
    method: 'GET',
    url: request.url,
    query: Object.fromEntries(request.query),
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
