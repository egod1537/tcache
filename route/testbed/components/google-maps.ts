import type { RouteCoordinate } from '../../../apps/testbed/src/api/client';

interface GoogleMapInstance {
  fitBounds(bounds: GoogleLatLngBounds): void;
  addListener(
    eventName: 'click',
    handler: (event: GoogleMapClickEvent) => void,
  ): GoogleMapsEventListener;
}

type GoogleLatLngBounds = object;

interface GoogleMapsEventListener {
  remove(): void;
}

interface GoogleMapClickEvent {
  latLng: { lat(): number; lng(): number } | null;
  placeId?: string;
  domEvent?: MouseEvent | PointerEvent | TouchEvent;
  stop?: () => void;
}

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
    label:
      | string
      | {
          text: string;
          color?: string;
          fontWeight?: string;
          fontSize?: string;
        };
    title: string;
    icon?: {
      path: unknown;
      fillColor: string;
      fillOpacity: number;
      scale: number;
      strokeColor: string;
      strokeWeight: number;
    };
    zIndex?: number;
  }) => { setMap(map: GoogleMapInstance | null): void };
  LatLngBounds: new (
    southwest?: RouteCoordinate,
    northeast?: RouteCoordinate,
  ) => GoogleLatLngBounds;
  SymbolPath: { CIRCLE: unknown };
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
      new Error('VITE_GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.'),
    );
  }
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const id = 'tcache-google-maps-script';
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    const loaded = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else
        reject(
          new Error('Google Maps JavaScript API를 초기화하지 못했습니다.'),
        );
    };
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener(
      'error',
      () =>
        reject(new Error('Google Maps JavaScript API를 불러오지 못했습니다.')),
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

export type { GoogleMapClickEvent, GoogleMapInstance, GoogleMapsApi };
