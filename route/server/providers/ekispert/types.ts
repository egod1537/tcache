export interface EkispertRequestSpec {
  url: string;
  query: URLSearchParams;
}

export interface EkispertCoordinate {
  lat: number;
  lng: number;
}

export interface EkispertRouteStep {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: EkispertCoordinate | null;
  endLocation: EkispertCoordinate | null;
  travelMode: 'TRANSIT' | 'WALKING';
  instruction: string | null;
  transitDetails: unknown | null;
}

export interface EkispertRouteLeg {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: EkispertCoordinate | null;
  endLocation: EkispertCoordinate | null;
  steps: EkispertRouteStep[];
  providerMetadata?: unknown;
}

export interface EkispertNormalizedRoute {
  description: string;
  routeLabels: string[];
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string;
  path: EkispertCoordinate[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
  legs: EkispertRouteLeg[];
  warnings: string[];
  departureTime: string | null;
  arrivalTime: string | null;
  transferCount: number | null;
  fare: { amount: number; currency: 'JPY' } | null;
  providerMetadata: unknown;
}

export interface EkispertRouteResult {
  provider: 'ekispert';
  routes: EkispertNormalizedRoute[];
  metadata: {
    upstreamStatus: 'OK';
    apiVersion: string | null;
    engineVersion: string | null;
  };
}
