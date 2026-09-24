import type {
  NormalizedRouteRequest,
  RouteTravelMode,
} from '../types/route.js';

export const ROUTE_PROVIDER_NAMES = [
  'google',
  'kakao-mobility',
  'kakao-maps',
  'ekispert',
  'navitime',
  'otp',
  'mock',
] as const;

export type RouteProviderName = (typeof ROUTE_PROVIDER_NAMES)[number];

export interface RouteProviderCapabilities {
  countries?: string[];
  modes: RouteTravelMode[];
  supportsWaypoints: boolean;
  maxLocations?: number;
  requiresCoordinates?: boolean;
  supportsDepartureTime?: boolean;
  requiresDepartureTime?: boolean;
  modeCapabilities?: Partial<
    Record<
      RouteTravelMode,
      Partial<
        Pick<
          RouteProviderCapabilities,
          | 'supportsWaypoints'
          | 'maxLocations'
          | 'requiresCoordinates'
          | 'supportsDepartureTime'
          | 'requiresDepartureTime'
        >
      >
    >
  >;
}

export interface RouteProviderResult {
  provider: string;
  result: unknown;
  debug?: {
    providerRequest?: unknown;
    rawProviderResponse?: unknown;
  };
}

export interface RouteProvider {
  /** Stable cache namespace. */
  readonly providerName?: string;
  readonly adapterVersion?: string;
  /** Optional provider/data identity included in cache canonicalization. */
  readonly cacheKeySeed?: string;
  /** Non-secret provider/data metadata persisted with cache entries. */
  readonly cacheMetadata?: Record<string, string>;
  readonly experimental?: boolean;
  readonly capabilities?: RouteProviderCapabilities;
  readonly available?: boolean;
  readonly unavailableReason?: string;
  getDiagnostics?(): Promise<Record<string, unknown>>;
  getDebugRequest?(request: NormalizedRouteRequest): unknown;
  getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult>;
}
