import { Callout, Classes, Intent } from '@blueprintjs/core';

import { RouteMapPanel } from '../components/RouteMapPanel';
import { RouteRequestPanel } from './RouteRequestPanel';
import { RouteResultPanel } from './RouteResultPanel';
import { useRoutePlayground } from './useRoutePlayground';

export function RoutePlaygroundPage() {
  const playground = useRoutePlayground();
  const selectedRoute =
    playground.response?.result.routes[playground.selectedRouteIndex] ?? null;

  return (
    <main className="route-tool-workspace route-playground-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>Google Routes Playground</h1>
          <p className={Classes.TEXT_MUTED}>
            Google provider를 직접 호출해 mapping, parsing, polyline과 bounds를
            검증합니다.
          </p>
        </div>
      </div>

      <div className="route-playground-grid">
        <RouteRequestPanel
          draft={playground.draft}
          onChange={playground.setDraft}
          onRawOverride={playground.setRawOverride}
          onReset={playground.reset}
          onRun={() => void playground.run()}
          onValidate={() => void playground.validate()}
          pending={playground.pending}
          rawJson={playground.rawJson}
          rawOverride={playground.rawOverride}
          validation={playground.validation}
        />
        <section className="route-playground-map" aria-label="Google Map">
          <RouteMapPanel
            pending={playground.pending}
            route={selectedRoute}
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
          {playground.error.message} The map remains available while you edit
          and retry the request.
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
