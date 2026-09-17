import type { NormalizedRouteRequest } from '../types/route.js';

export interface RouteProviderResult {
  provider: string;
  result: unknown;
}

export interface RouteProvider {
  getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult>;
}
