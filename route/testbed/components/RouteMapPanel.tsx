import { Button, Callout, Intent, Spinner } from '@blueprintjs/core';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { NormalizedRoute } from '../../../apps/testbed/src/api/client';
import { MapLocationActions } from '../route/MapLocationActions';
import {
  mapClickEventToSelection,
  type MapLocationSelection,
  type MapLocationTarget,
  type RequestMapMarker,
} from '../route/map-location-selection';
import {
  loadGoogleMaps,
  type GoogleMapClickEvent,
  type GoogleMapInstance,
  type GoogleMapsApi,
} from './google-maps';

const frontendApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as
  string | undefined;

export function RouteMapPanel({
  route,
  pending = false,
  locationSelectionDisabled = false,
  workspace = false,
  requestMarkers,
  selectedLocation = null,
  selectionError,
  onMapLocationSelect,
  onMapLocationApply,
  onMapLocationCancel,
}: {
  route?: NormalizedRoute | null;
  pending?: boolean;
  locationSelectionDisabled?: boolean;
  workspace?: boolean;
  requestMarkers?: RequestMapMarker[];
  selectedLocation?: MapLocationSelection | null;
  selectionError?: string | null;
  onMapLocationSelect?: (selection: MapLocationSelection) => void;
  onMapLocationApply?: (target: MapLocationTarget) => void;
  onMapLocationCancel?: () => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsApi | null>(null);
  const routeOverlaysRef = useRef<Array<{ setMap(map: null): void }>>([]);
  const requestOverlaysRef = useRef<Array<{ setMap(map: null): void }>>([]);
  const selectionOverlayRef = useRef<{ setMap(map: null): void } | null>(null);
  const onMapLocationSelectRef = useRef(onMapLocationSelect);
  const selectionDisabledRef = useRef(pending || locationSelectionDisabled);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    x: number;
    y: number;
    placement: 'above' | 'below';
  } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    frontendApiKey ? 'loading' : 'error',
  );
  const [error, setError] = useState(
    frontendApiKey ? '' : 'VITE_GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.',
  );

  onMapLocationSelectRef.current = onMapLocationSelect;
  selectionDisabledRef.current = pending || locationSelectionDisabled;

  function fitRoute() {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !route?.bounds) return;
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
    let clickListener: { remove(): void } | null = null;
    void loadGoogleMaps(frontendApiKey)
      .then((maps) => {
        if (!active || !elementRef.current) return;
        mapsRef.current = maps;
        const map = new maps.Map(elementRef.current, {
          center: route?.path[0] ?? { lat: 35.6812, lng: 139.7671 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: true,
        });
        mapRef.current = map;
        clickListener = map.addListener('click', (event) => {
          if (!onMapLocationSelectRef.current) return;
          // Google exposes stop() on POI click events to suppress its InfoWindow.
          if (event.placeId) event.stop?.();
          if (selectionDisabledRef.current) return;
          const selection = mapClickEventToSelection(event);
          if (!selection) return;
          setSelectionAnchor(getSelectionAnchor(event, elementRef.current));
          onMapLocationSelectRef.current(selection);
        });
        setState('ready');
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setState('error');
        setError(
          loadError instanceof Error
            ? loadError.message
            : '지도를 불러오지 못했습니다.',
        );
      });
    return () => {
      active = false;
      clickListener?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (state !== 'ready' || !map || !maps) return;

    routeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    const overlays: Array<{ setMap(map: GoogleMapInstance | null): void }> = [];
    if (route?.path.length) {
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

    // Existing read-only map consumers still receive result endpoint markers.
    if (requestMarkers === undefined) {
      const endpoints = route?.legs.length
        ? [
            route.legs[0]?.startLocation,
            ...route.legs.map((leg) => leg.endLocation),
          ]
        : route
          ? [route.path[0], route.path.at(-1)]
          : [];
      endpoints.forEach((position, index) => {
        if (!position) return;
        const last = index === endpoints.length - 1;
        overlays.push(
          new maps.Marker({
            map,
            position,
            label: index === 0 ? 'A' : last ? 'B' : String(index),
            title: index === 0 ? '출발지' : last ? '도착지' : `경유지 ${index}`,
          }),
        );
      });
    }
    routeOverlaysRef.current = overlays;

    if (route?.bounds) {
      map.fitBounds(
        new maps.LatLngBounds(
          { lat: route.bounds.south, lng: route.bounds.west },
          { lat: route.bounds.north, lng: route.bounds.east },
        ),
      );
    }
  }, [requestMarkers === undefined, route, state]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (state !== 'ready' || !map || !maps) return;

    requestOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    requestOverlaysRef.current = [];
    if (!requestMarkers) return;
    requestOverlaysRef.current = requestMarkers.map((marker) => {
      const label =
        marker.kind === 'origin'
          ? 'A'
          : marker.kind === 'destination'
            ? 'B'
            : String(marker.index);
      const title =
        marker.kind === 'origin'
          ? '출발지'
          : marker.kind === 'destination'
            ? '도착지'
            : `경유지 ${marker.index}`;
      const fillColor =
        marker.kind === 'origin'
          ? '#0f9960'
          : marker.kind === 'destination'
            ? '#db3737'
            : '#137cbd';
      return new maps.Marker({
        map,
        position: marker.position,
        label: { text: label, color: '#ffffff', fontWeight: '700' },
        title,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          fillColor,
          fillOpacity: 1,
          scale: 13,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        zIndex: 20,
      });
    });
  }, [requestMarkers, state]);

  useEffect(() => {
    selectionOverlayRef.current?.setMap(null);
    selectionOverlayRef.current = null;

    const map = mapRef.current;
    const maps = mapsRef.current;
    if (
      state !== 'ready' ||
      !map ||
      !maps ||
      pending ||
      locationSelectionDisabled ||
      !selectedLocation
    ) {
      return;
    }
    selectionOverlayRef.current = new maps.Marker({
      map,
      position: { lat: selectedLocation.lat, lng: selectedLocation.lng },
      label: { text: '+', color: '#1c2127', fontWeight: '700' },
      title: '선택한 지도 위치',
      icon: {
        path: maps.SymbolPath.CIRCLE,
        fillColor: '#fbb360',
        fillOpacity: 1,
        scale: 11,
        strokeColor: '#1c2127',
        strokeWeight: 2,
      },
      zIndex: 30,
    });
  }, [locationSelectionDisabled, pending, selectedLocation, state]);

  useEffect(
    () => () => {
      routeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      requestOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      selectionOverlayRef.current?.setMap(null);
    },
    [],
  );

  const selectionCardStyle = selectionAnchor
    ? ({
        '--route-map-selection-x': `${selectionAnchor.x}px`,
        '--route-map-selection-y': `${selectionAnchor.y}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`route-map-panel${workspace ? ' route-map-workspace' : ''}`}
    >
      <div className="route-map-toolbar">
        <span>
          {pending
            ? '경로 실행 중에는 위치를 선택할 수 없습니다'
            : locationSelectionDisabled && onMapLocationSelect
              ? '지도 위치를 편집하려면 원본 JSON 편집을 해제하세요'
              : route
                ? `경로 점 ${route.path.length.toLocaleString()}개`
                : onMapLocationSelect
                  ? '지도에서 경로 위치를 선택하세요'
                  : '도쿄 · 경로 요청 대기 중'}
        </span>
        <Button
          disabled={state !== 'ready' || !route?.bounds}
          icon="zoom-to-fit"
          onClick={fitRoute}
          size="small"
        >
          경로 맞춤
        </Button>
      </div>
      <div className="route-map-canvas" ref={elementRef} />
      {state === 'ready' &&
        !pending &&
        !locationSelectionDisabled &&
        selectedLocation &&
        onMapLocationApply &&
        onMapLocationCancel && (
          <div
            className={`route-map-selection-popover route-map-selection-${selectionAnchor?.placement ?? 'below'}`}
            style={selectionCardStyle}
          >
            <MapLocationActions
              error={selectionError}
              onApply={onMapLocationApply}
              onCancel={onMapLocationCancel}
              selection={selectedLocation}
            />
          </div>
        )}
      {state === 'loading' && (
        <div className="route-map-overlay">
          <Spinner size={28} />
          Google 지도를 불러오는 중…
        </div>
      )}
      {state === 'error' && (
        <div className="route-map-overlay">
          <Callout intent={Intent.WARNING} title="지도를 사용할 수 없습니다">
            {error} 백엔드 전용 GOOGLE_MAPS_API_KEY를 사용한 경로 계산은 계속
            실행할 수 있습니다.
          </Callout>
        </div>
      )}
      {state === 'ready' && pending && (
        <div className="route-map-overlay route-map-pending">
          <Spinner size={32} />
          Google Routes 요청 중…
        </div>
      )}
    </div>
  );
}

function getSelectionAnchor(
  event: GoogleMapClickEvent,
  mapElement: HTMLDivElement | null,
) {
  const rect = mapElement?.getBoundingClientRect();
  const point = getClientPoint(event.domEvent);
  const width = rect?.width ?? 600;
  const rawX = point && rect ? point.x - rect.left : width / 2;
  const rawY = point && rect ? point.y - rect.top : (rect?.height ?? 416) / 2;
  return {
    x: Math.min(Math.max(rawX, 150), Math.max(150, width - 150)),
    y: rawY + 44,
    placement: rawY > 260 ? ('above' as const) : ('below' as const),
  };
}

function getClientPoint(event: GoogleMapClickEvent['domEvent']) {
  if (!event) return null;
  if ('clientX' in event && 'clientY' in event) {
    return { x: event.clientX, y: event.clientY };
  }
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}
