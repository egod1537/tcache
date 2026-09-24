import type { NormalizedRouteRequest } from '../../types/route.js';
import type {
  RouteProvider,
  RouteProviderCapabilities,
  RouteProviderResult,
} from '../provider.js';
import { validateRouteRequestForProvider } from '../location-validation.js';
import { requestKakaoRoute } from './http.js';
import { toKakaoMapsRequest } from './mapper.js';
import { parseKakaoMapsResponse } from './parser.js';

export class KakaoMapsRouteProvider implements RouteProvider {
  readonly providerName = 'kakao-maps';
  readonly adapterVersion = '1';
  readonly capabilities: RouteProviderCapabilities = {
    countries: ['KR'],
    modes: ['TRANSIT', 'WALKING', 'BICYCLING'],
    supportsWaypoints: true,
    maxLocations: 7,
    requiresCoordinates: true,
    modeCapabilities: {
      TRANSIT: { supportsWaypoints: false, maxLocations: 2 },
    },
  };

  constructor(private readonly apiKey: string) {}

  getDebugRequest(request: NormalizedRouteRequest) {
    return debugRequest(toKakaoMapsRequest(request));
  }

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    validateRouteRequestForProvider(request, this.providerName);
    if (request.travelMode === 'DRIVING') {
      throw new Error('Kakao Maps routing does not support DRIVING');
    }
    const upstreamRequest = toKakaoMapsRequest(request);
    const raw = await requestKakaoRoute(
      this.providerName,
      this.apiKey,
      upstreamRequest,
      signal,
    );
    return {
      provider: this.providerName,
      result: parseKakaoMapsResponse(raw, request.travelMode),
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
