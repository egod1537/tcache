import type { NormalizedRouteRequest } from '../../types/route.js';
import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderResult,
} from '../provider.js';
import { validateRouteRequestForProvider } from '../location-validation.js';
import { requestKakaoRoute } from './http.js';
import { toKakaoMobilityRequest } from './mapper.js';
import { parseKakaoMobilityResponse } from './parser.js';

export class KakaoMobilityRouteProvider implements RouteProvider {
  readonly providerName = 'kakao-mobility';
  readonly adapterVersion = '1';
  readonly capabilities: RouteProviderCapabilities = {
    countries: ['KR'],
    modes: ['DRIVING'],
    supportsWaypoints: true,
    maxLocations: 7,
    requiresCoordinates: true,
  };
  readonly available: boolean;
  readonly unavailableReason?: string;

  constructor(private readonly apiKey: string) {
    this.available = Boolean(apiKey);
    if (!this.available) {
      this.unavailableReason = 'KAKAO_MOBILITY_API_KEY is not configured';
    }
  }

  getDebugRequest(request: NormalizedRouteRequest) {
    return debugRequest(toKakaoMobilityRequest(request));
  }

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    validateRouteRequestForProvider(request, this.providerName);
    const upstreamRequest = toKakaoMobilityRequest(request);
    const raw = await requestKakaoRoute(
      this.providerName,
      this.apiKey,
      upstreamRequest,
      signal,
    );
    return {
      provider: this.providerName,
      result: parseKakaoMobilityResponse(raw),
      debug: {
        providerRequest: debugRequest(upstreamRequest),
        rawProviderResponse: raw,
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
