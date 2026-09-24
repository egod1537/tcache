export interface OtpDatasetIdentity {
  graphBuildId?: string;
  gtfsDatasetVersion?: string;
  osmDatasetVersion?: string;
}

export interface OtpGraphqlRequest {
  operationName: 'PlanTokyo';
  query: string;
  variables: {
    origin: OtpLabeledLocation;
    destination: OtpLabeledLocation;
    dateTime: { earliestDeparture: string };
    first: number;
  };
}

export interface OtpLabeledLocation {
  label: string;
  location: {
    coordinate: { latitude: number; longitude: number };
  };
}

export interface OtpRequestSpec {
  url: string;
  body: OtpGraphqlRequest;
  language: string;
}

export interface OtpCoordinate {
  lat: number;
  lng: number;
}

export interface OtpNormalizedRouteResult {
  provider: 'otp';
  routes: Array<{
    description: string;
    routeLabels: string[];
    distanceMeters: number | null;
    durationSeconds: number | null;
    encodedPolyline: string;
    path: OtpCoordinate[];
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    } | null;
    legs: Array<{
      distanceMeters: number | null;
      durationSeconds: number | null;
      startLocation: OtpCoordinate | null;
      endLocation: OtpCoordinate | null;
      steps: Array<{
        distanceMeters: number | null;
        durationSeconds: number | null;
        startLocation: OtpCoordinate | null;
        endLocation: OtpCoordinate | null;
        travelMode: 'TRANSIT' | 'WALKING';
        instruction: string | null;
        transitDetails: unknown | null;
      }>;
      providerMetadata: unknown;
    }>;
    warnings: string[];
    departureTime: string | null;
    arrivalTime: string | null;
    transferCount: number | null;
    providerMetadata: unknown;
  }>;
  metadata: {
    upstreamStatus: 'OK';
    itineraryCount: number;
    selectionPolicy: 'all-returned-in-upstream-order';
    searchDateTime: string | null;
    datasetIdentity: OtpDatasetIdentity;
  };
}
