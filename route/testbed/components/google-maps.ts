import type { RouteCoordinate } from '../../../apps/testbed/src/api/client';

interface GoogleMapInstance {
  fitBounds(bounds: GoogleLatLngBounds): void;
}

type GoogleLatLngBounds = object;

interface GoogleMapsApi {
  Map: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => GoogleMapInstance;
  Polyline: new (options: {
    map: GoogleMapInstance;
    path: RouteCoordinate[];
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
  }) => { setMap(map: GoogleMapInstance | null): void };
  Marker: new (options: {
    map: GoogleMapInstance;
    position: RouteCoordinate;
    label: string;
    title: string;
  }) => { setMap(map: GoogleMapInstance | null): void };
  LatLngBounds: new (
    southwest?: RouteCoordinate,
    northeast?: RouteCoordinate,
  ) => GoogleLatLngBounds;
}

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
  }
}

let loader: Promise<GoogleMapsApi> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey) {
    return Promise.reject(
      new Error('VITE_GOOGLE_MAPS_API_KEY is not configured'),
    );
  }
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const id = 'tcache-google-maps-script';
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    const loaded = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps JavaScript API did not initialize'));
    };
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Google Maps JavaScript API failed to load')),
      { once: true },
    );
    if (!existing) {
      script.id = id;
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      document.head.append(script);
    }
  });
  return loader;
}

export type { GoogleMapInstance, GoogleMapsApi };
