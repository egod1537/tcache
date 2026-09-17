import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  Intent,
  Switch,
  Tag,
} from '@blueprintjs/core';

import type { RouteRequestDraft, ValidationState } from './playground-types';
import { RouteAdvancedOptions } from './RouteAdvancedOptions';
import { RouteIntermediateList } from './RouteIntermediateList';
import { RouteLocationInput } from './RouteLocationInput';
import { RouteModeSelector } from './RouteModeSelector';

export function RouteRequestPanel({
  draft,
  rawJson,
  rawOverride,
  validation,
  pending,
  onChange,
  onRawOverride,
  onReset,
  onValidate,
  onRun,
}: {
  draft: RouteRequestDraft;
  rawJson: string;
  rawOverride: string | null;
  validation: ValidationState;
  pending: boolean;
  onChange: (draft: RouteRequestDraft) => void;
  onRawOverride: (value: string | null) => void;
  onReset: () => void;
  onValidate: () => void;
  onRun: () => void;
}) {
  return (
    <Card className="route-playground-request-panel" compact elevation={1}>
      <div className="route-playground-panel-heading">
        <div>
          <h2 className={Classes.HEADING}>Route Request</h2>
          <p className={Classes.TEXT_MUTED}>
            Google Routes backend에 직접 요청합니다.
          </p>
        </div>
        {validation.state === 'valid' && (
          <Tag icon="tick" intent={Intent.SUCCESS}>
            유효함
          </Tag>
        )}
      </div>

      <RouteLocationInput
        label="Origin"
        onChange={(origin) => onChange({ ...draft, origin })}
        value={draft.origin}
      />
      <RouteIntermediateList
        onChange={(intermediates) => onChange({ ...draft, intermediates })}
        values={draft.intermediates}
      />
      <RouteLocationInput
        label="Destination"
        onChange={(destination) => onChange({ ...draft, destination })}
        value={draft.destination}
      />
      <RouteModeSelector
        onChange={(travelMode) =>
          onChange({
            ...draft,
            travelMode,
            ...(travelMode !== 'DRIVING' ? { routingPreference: '' } : {}),
          })
        }
        value={draft.travelMode}
      />
      <Switch
        checked={draft.computeAlternativeRoutes}
        label="Alternative Routes"
        onChange={(event) =>
          onChange({
            ...draft,
            computeAlternativeRoutes: event.currentTarget.checked,
          })
        }
      />
      <RouteAdvancedOptions
        draft={draft}
        onChange={onChange}
        onRawOverride={onRawOverride}
        rawJson={rawJson}
        rawOverride={rawOverride}
      />

      {validation.state === 'invalid' && (
        <Callout compact intent={Intent.DANGER} title="Invalid request">
          {validation.message}
        </Callout>
      )}

      <ButtonGroup className="route-playground-actions" fill>
        <Button disabled={pending} icon="reset" onClick={onReset}>
          Reset
        </Button>
        <Button disabled={pending} icon="tick-circle" onClick={onValidate}>
          Validate
        </Button>
        <Button
          icon="play"
          intent={Intent.PRIMARY}
          loading={pending}
          onClick={onRun}
        >
          Run Route
        </Button>
      </ButtonGroup>
    </Card>
  );
}
