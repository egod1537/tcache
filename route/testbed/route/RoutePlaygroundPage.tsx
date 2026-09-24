import { Callout, Classes, Intent } from '@blueprintjs/core';
import { useEffect, useMemo, useReducer, useState } from 'react';

import type { RouteCoordinate } from '../../../apps/testbed/src/api/client';
import { RouteMapPanel } from '../components/RouteMapPanel';
import {
  applyMapLocationSelection,
  buildRequestMapMarkers,
  buildResultMapMarkers,
  EMPTY_MAP_SELECTION_STATE,
  mapSelectionMarkerKey,
  mapSelectionReducer,
  type MapLocationSelection,
  type MapLocationTarget,
} from './map-location-selection';
import { buildRouteRequest, parseRawRouteRequest } from './playground-types';
import { RouteRequestPanel } from './RouteRequestPanel';
import { RouteResultPanel } from './RouteResultPanel';
import { useRoutePlayground } from './useRoutePlayground';
import { ProviderPolicyPanel } from './ProviderPolicyPanel';

export function RoutePlaygroundPage() {
  const playground = useRoutePlayground();
  const [mapSelection, dispatchMapSelection] = useReducer(
    mapSelectionReducer,
    EMPTY_MAP_SELECTION_STATE,
  );
  const [knownMapPositions, setKnownMapPositions] = useState<
    Record<string, RouteCoordinate>
  >({});
  const selectedRoute =
    playground.response?.result.routes[playground.selectedRouteIndex] ?? null;
  const submittedRequestMatches = useMemo(() => {
    if (!playground.submittedRequest) return false;
    try {
      const currentRequest =
        playground.rawOverride === null
          ? buildRouteRequest(playground.draft)
          : parseRawRouteRequest(playground.rawOverride);
      return (
        JSON.stringify(currentRequest) ===
        JSON.stringify(playground.submittedRequest)
      );
    } catch {
      return false;
    }
  }, [playground.draft, playground.rawOverride, playground.submittedRequest]);
  const fallbackPositions = useMemo(() => {
    if (!selectedRoute || !submittedRequestMatches) return [];
    if (selectedRoute.legs.length) {
      return [
        selectedRoute.legs[0]?.startLocation,
        ...selectedRoute.legs.map((leg) => leg.endLocation),
      ];
    }
    return [
      selectedRoute.path[0],
      ...Array.from(
        { length: getSubmittedIntermediateCount(playground.submittedRequest) },
        () => null,
      ),
      selectedRoute.path.at(-1),
    ];
  }, [playground.submittedRequest, selectedRoute, submittedRequestMatches]);
  const requestMarkers = useMemo(() => {
    if (playground.rawOverride !== null) {
      return submittedRequestMatches
        ? buildResultMapMarkers(fallbackPositions)
        : [];
    }
    return buildRequestMapMarkers(
      playground.draft,
      knownMapPositions,
      fallbackPositions,
    );
  }, [
    fallbackPositions,
    knownMapPositions,
    playground.draft,
    playground.rawOverride,
    submittedRequestMatches,
  ]);

  useEffect(() => {
    if (playground.pending || playground.rawOverride !== null) {
      dispatchMapSelection({ type: 'cancel' });
    }
  }, [playground.pending, playground.rawOverride]);

  function selectMapLocation(selection: MapLocationSelection) {
    dispatchMapSelection({
      type: 'select',
      selection,
      disabled: playground.pending || playground.rawOverride !== null,
    });
  }

  function applyMapLocation(target: MapLocationTarget) {
    const selection = mapSelection.selection;
    if (!selection || playground.pending || playground.rawOverride !== null) {
      return;
    }
    const result = applyMapLocationSelection(
      playground.draft,
      selection,
      target,
    );
    if (!result.applied) {
      dispatchMapSelection({ type: 'limit-reached' });
      return;
    }

    playground.setDraft(result.draft);
    setKnownMapPositions((current) => ({
      ...current,
      [mapSelectionMarkerKey(selection)]: {
        lat: selection.lat,
        lng: selection.lng,
      },
    }));
    dispatchMapSelection({ type: 'cancel' });
  }

  function resetPlayground() {
    dispatchMapSelection({ type: 'cancel' });
    setKnownMapPositions({});
    playground.reset();
  }

  return (
    <main className="route-tool-workspace route-playground-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>Route Playground</h1>
          <p className={Classes.TEXT_MUTED}>
            국가와 이동수단에 따른 provider 선택과 정규화 결과를 검증합니다.
          </p>
        </div>
      </div>

      <ProviderPolicyPanel />

      <div className="route-playground-grid">
        <RouteRequestPanel
          draft={playground.draft}
          onChange={playground.setDraft}
          onRawOverride={playground.setRawOverride}
          onReset={resetPlayground}
          onRun={() => void playground.run()}
          onValidate={() => void playground.validate()}
          pending={playground.pending}
          rawJson={playground.rawJson}
          rawOverride={playground.rawOverride}
          validation={playground.validation}
          selectedPresetId={playground.selectedPresetId}
          onSelectPreset={playground.selectPreset}
        />
        <section className="route-playground-map" aria-label="경로 지도">
          <RouteMapPanel
            locationSelectionDisabled={playground.rawOverride !== null}
            onMapLocationApply={applyMapLocation}
            onMapLocationCancel={() => dispatchMapSelection({ type: 'cancel' })}
            onMapLocationSelect={selectMapLocation}
            pending={playground.pending}
            requestMarkers={requestMarkers}
            route={selectedRoute}
            selectedLocation={mapSelection.selection}
            selectionError={mapSelection.error}
            workspace
          />
        </section>
      </div>

      {playground.error && (
        <Callout
          className="route-playground-error-callout"
          intent={Intent.DANGER}
          title={playground.error.code}
        >
          {playground.error.message} 요청을 수정해 다시 실행하는 동안에도 지도를
          사용할 수 있습니다.
        </Callout>
      )}

      <RouteResultPanel
        error={playground.error}
        onSelectRoute={playground.setSelectedRouteIndex}
        pending={playground.pending}
        requestTimestamp={playground.requestTimestamp}
        response={playground.response}
        selectedRouteIndex={playground.selectedRouteIndex}
        submittedRequest={playground.submittedRequest}
      />
    </main>
  );
}

function getSubmittedIntermediateCount(request: unknown) {
  if (!request || typeof request !== 'object') return 0;
  const input = request as { locations?: unknown; intermediates?: unknown };
  if (Array.isArray(input.locations)) {
    return Math.max(0, input.locations.length - 2);
  }
  const intermediates = input.intermediates;
  return Array.isArray(intermediates) ? intermediates.length : 0;
}
