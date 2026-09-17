export interface GoogleLatLng {
  latitude: number;
  longitude: number;
}

export interface GoogleWaypoint {
  placeId?: string;
  address?: string;
  location?: { latLng: GoogleLatLng };
}

export interface GoogleRoutesRequest {
  origin: GoogleWaypoint;
  destination: GoogleWaypoint;
  intermediates?: GoogleWaypoint[];
  travelMode: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT';
  departureTime?: string;
  computeAlternativeRoutes: boolean;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
}

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface RouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface NormalizedRouteStep {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: RouteCoordinate | null;
  endLocation: RouteCoordinate | null;
  travelMode: string | null;
  instruction: string | null;
  transitDetails: unknown | null;
}

export interface NormalizedRouteLeg {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: RouteCoordinate | null;
  endLocation: RouteCoordinate | null;
  steps: NormalizedRouteStep[];
}

export interface NormalizedGoogleRoute {
  description: string;
  routeLabels: string[];
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string;
  path: RouteCoordinate[];
  bounds: RouteBounds | null;
  legs: NormalizedRouteLeg[];
  warnings: string[];
}

export interface GoogleProviderDebug {
  request: unknown;
  fieldMask: string;
  httpStatus: number;
  latencyMs: number;
}

export interface GoogleRouteResult {
  provider: 'google';
  routes: NormalizedGoogleRoute[];
  raw: unknown;
  debug: GoogleProviderDebug;
}
