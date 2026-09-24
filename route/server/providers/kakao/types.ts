export interface KakaoRequestSpec {
  url: string;
  query: URLSearchParams;
}

export interface KakaoRouteCoordinate {
  lat: number;
  lng: number;
}

export interface KakaoRouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface KakaoNormalizedRouteStep {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: KakaoRouteCoordinate | null;
  endLocation: KakaoRouteCoordinate | null;
  travelMode: string | null;
  instruction: string | null;
  transitDetails: unknown | null;
}

export interface KakaoNormalizedRouteLeg {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: KakaoRouteCoordinate | null;
  endLocation: KakaoRouteCoordinate | null;
  steps: KakaoNormalizedRouteStep[];
}

export interface KakaoNormalizedRoute {
  description: string;
  routeLabels: string[];
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string;
  path: KakaoRouteCoordinate[];
  bounds: KakaoRouteBounds | null;
  legs: KakaoNormalizedRouteLeg[];
  warnings: string[];
}

export interface KakaoRouteResult {
  provider: 'kakao-mobility' | 'kakao-maps';
  routes: KakaoNormalizedRoute[];
  metadata: {
    upstreamStatus: string;
    transactionId?: string;
  };
}
