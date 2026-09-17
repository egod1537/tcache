import type { NormalizedRouteRequest } from '../types/route.js';

export interface RouteProviderResult {
  provider: string;
  result: unknown;
}

export interface RouteProvider {
  /** Stable cache namespace. */
  readonly providerName?: string;
  getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult>;
}
