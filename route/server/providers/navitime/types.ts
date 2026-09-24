export interface NavitimeRequestSpec {
  url: string;
  query: URLSearchParams;
}

export interface NavitimeCoordinate {
  lat: number;
  lng: number;
}

export interface NavitimeRouteStep {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: NavitimeCoordinate | null;
  endLocation: NavitimeCoordinate | null;
  travelMode: string | null;
  instruction: string | null;
  transitDetails: unknown | null;
}

export interface NavitimeRouteLeg {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: NavitimeCoordinate | null;
  endLocation: NavitimeCoordinate | null;
  steps: NavitimeRouteStep[];
  providerMetadata?: unknown;
}

export interface NavitimeNormalizedRoute {
  description: string;
  routeLabels: string[];
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string;
  path: NavitimeCoordinate[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
  legs: NavitimeRouteLeg[];
  warnings: string[];
  providerMetadata: unknown;
}

export interface NavitimeRouteResult {
  provider: 'navitime';
  routes: NavitimeNormalizedRoute[];
  metadata: { upstreamStatus: string };
}
