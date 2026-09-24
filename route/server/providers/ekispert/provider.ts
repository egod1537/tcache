import type { NormalizedRouteRequest } from '../../types/route.js';
import { validateRouteRequestForProvider } from '../location-validation.js';
import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderResult,
} from '../provider.js';
import {
  createEkispertHttpError,
  createEkispertNetworkError,
  EkispertRouteProviderError,
} from './errors.js';
import {
  DEFAULT_EKISPERT_API_BASE_URL,
  EKISPERT_MAX_LOCATIONS,
  toEkispertTransitRequest,
} from './mapper.js';
import { parseEkispertTransitResponse } from './parser.js';

export class EkispertRouteProvider implements RouteProvider {
  readonly providerName = 'ekispert';
  readonly adapterVersion = '1';
  readonly capabilities: RouteProviderCapabilities = {
    countries: ['JP'],
    modes: ['TRANSIT'],
    supportsWaypoints: true,
    maxLocations: EKISPERT_MAX_LOCATIONS,
    supportsDepartureTime: true,
    requiresDepartureTime: true,
  };
  readonly available: boolean;
  readonly unavailableReason?: string;

  constructor(
    private readonly apiKey: string,
    private readonly apiBaseUrl = DEFAULT_EKISPERT_API_BASE_URL,
  ) {
    this.available = Boolean(apiKey);
    if (!this.available) {
      this.unavailableReason = 'EKISPERT_API_KEY is not configured';
    }
  }

  getDebugRequest(request: NormalizedRouteRequest) {
    return debugRequest(toEkispertTransitRequest(request, this.apiBaseUrl));
  }

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    validateRouteRequestForProvider(request, this.providerName);
    if (!this.apiKey) {
      throw new EkispertRouteProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'Ekispert route provider is not configured',
        {
          provider: 'ekispert',
          httpStatus: null,
          status: 'NOT_CONFIGURED',
        },
      );
    }
    const upstreamRequest = toEkispertTransitRequest(request, this.apiBaseUrl);
    const url = new URL(upstreamRequest.url);
    const query = upstreamRequest.query.toString().replaceAll('%3A', ':');
    url.search = `${query}&key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw createEkispertNetworkError(error);
    }

    let body: unknown;
    try {
      body = await readBody(response);
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw createEkispertNetworkError(error);
    }
    if (!response.ok) {
      throw createEkispertHttpError(response.status, body);
    }
    return {
      provider: this.providerName,
      result: parseEkispertTransitResponse(body),
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
    transformation: {
      strategy: 'direct-via-list',
      coordinateLookupRequired: false,
    },
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
