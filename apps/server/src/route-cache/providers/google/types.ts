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
  travelMode: string;
  departureTime?: string;
  computeAlternativeRoutes?: boolean;
  languageCode?: string;
  units?: string;
}
