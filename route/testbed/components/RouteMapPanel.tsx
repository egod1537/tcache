import { Button, Callout, Intent, Spinner } from '@blueprintjs/core';
import { useEffect, useRef, useState } from 'react';

import type { NormalizedRoute } from '../../../apps/testbed/src/api/client';
import {
  loadGoogleMaps,
  type GoogleMapInstance,
  type GoogleMapsApi,
} from './google-maps';

const frontendApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as
  string | undefined;

export function RouteMapPanel({ route }: { route: NormalizedRoute }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsApi | null>(null);
  const overlaysRef = useRef<Array<{ setMap(map: null): void }>>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    frontendApiKey ? 'loading' : 'error',
  );
  const [error, setError] = useState(
    frontendApiKey ? '' : 'VITE_GOOGLE_MAPS_API_KEY is not configured.',
  );

  function fitRoute() {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !route.bounds) return;
    map.fitBounds(
      new maps.LatLngBounds(
        { lat: route.bounds.south, lng: route.bounds.west },
        { lat: route.bounds.north, lng: route.bounds.east },
      ),
    );
  }

  useEffect(() => {
    if (!frontendApiKey || !elementRef.current) return;
    let active = true;
    void loadGoogleMaps(frontendApiKey)
      .then((maps) => {
        if (!active || !elementRef.current) return;
        mapsRef.current = maps;
        const map =
          mapRef.current ??
          new maps.Map(elementRef.current, {
            center: route.path[0] ?? { lat: 35.6812, lng: 139.7671 },
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
          });
        mapRef.current = map;
        overlaysRef.current.forEach((overlay) => overlay.setMap(null));

        const overlays: Array<{ setMap(map: GoogleMapInstance | null): void }> =
          [];
        if (route.path.length) {
          overlays.push(
            new maps.Polyline({
              map,
              path: route.path,
              strokeColor: '#137cbd',
              strokeOpacity: 0.9,
              strokeWeight: 6,
            }),
          );
        }
        const endpoints = route.legs.length
          ? [
              route.legs[0]?.startLocation,
              ...route.legs.map((leg) => leg.endLocation),
            ]
          : [route.path[0], route.path.at(-1)];
        endpoints.forEach((position, index) => {
          if (!position) return;
          const last = index === endpoints.length - 1;
          overlays.push(
            new maps.Marker({
              map,
              position,
              label: index === 0 ? 'O' : last ? 'D' : String(index),
              title:
                index === 0
                  ? 'Origin'
                  : last
                    ? 'Destination'
                    : `Intermediate ${index}`,
            }),
          );
        });
        overlaysRef.current = overlays;
        setState('ready');
        if (route.bounds) {
          map.fitBounds(
            new maps.LatLngBounds(
              { lat: route.bounds.south, lng: route.bounds.west },
              { lat: route.bounds.north, lng: route.bounds.east },
            ),
          );
        }
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setState('error');
        setError(
          loadError instanceof Error ? loadError.message : 'Map load failed',
        );
      });
    return () => {
      active = false;
    };
  }, [route]);

  useEffect(
    () => () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    },
    [],
  );

  return (
    <div className="route-map-panel">
      <div className="route-map-toolbar">
        <span>{route.path.length.toLocaleString()} path points</span>
        <Button
          disabled={state !== 'ready' || !route.bounds}
          icon="zoom-to-fit"
          onClick={fitRoute}
          size="small"
        >
          Fit Route
        </Button>
      </div>
      <div className="route-map-canvas" ref={elementRef} />
      {state === 'loading' && (
        <div className="route-map-overlay">
          <Spinner size={28} />
          Loading Google Maps…
        </div>
      )}
      {state === 'error' && (
        <div className="route-map-overlay">
          <Callout intent={Intent.WARNING} title="Map unavailable">
            {error} Route calculation still runs with the backend-only
            GOOGLE_MAPS_API_KEY.
          </Callout>
        </div>
      )}
    </div>
  );
}
