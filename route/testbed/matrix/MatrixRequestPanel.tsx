import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
} from '@blueprintjs/core';

import { RouteModeSelector } from '../route/RouteModeSelector';
import { MATRIX_PRESETS, getMatrixPreset } from './matrix-presets';
import type { MatrixRequestDraft } from './matrix-types';
import { MatrixLocationEditor } from './MatrixLocationEditor';

export function MatrixRequestPanel({
  draft,
  presetId,
  pending,
  validationError,
  onChange,
  onPreset,
  onRun,
}: {
  draft: MatrixRequestDraft;
  presetId: string;
  pending: boolean;
  validationError: string | null;
  onChange: (draft: MatrixRequestDraft) => void;
  onPreset: (presetId: string) => void;
  onRun: () => void;
}) {
  const selectedPreset = getMatrixPreset(presetId);

  return (
    <Card className="matrix-request-panel" compact elevation={1}>
      <div className="route-playground-panel-heading">
        <div>
          <h2 className={Classes.HEADING}>Request Builder</h2>
          <p className={Classes.TEXT_MUTED}>
            Browser는 Matrix Job 하나만 생성합니다.
          </p>
        </div>
      </div>

      <FormGroup label="Preset" labelFor="matrix-preset">
        <HTMLSelect
          disabled={pending}
          fill
          id="matrix-preset"
          onChange={(event) => onPreset(event.target.value)}
          options={MATRIX_PRESETS.map(({ id, label }) => ({
            value: id,
            label,
          }))}
          value={presetId}
        />
      </FormGroup>

      {selectedPreset.verifiedAt && (
        <Callout compact icon="map-marker">
          Place IDs verified {selectedPreset.verifiedAt} ·{' '}
          {selectedPreset.timezone}
        </Callout>
      )}

      <MatrixLocationEditor
        disabled={pending}
        locations={draft.locations}
        onChange={(locations) => onChange({ ...draft, locations })}
      />

      <RouteModeSelector
        disabled={pending}
        onChange={(mode) =>
          onChange({
            ...draft,
            mode,
            ...(mode !== 'DRIVING' ? { routingPreference: '' } : {}),
          })
        }
        value={draft.mode}
      />

      <FormGroup label="Departure Time" labelFor="matrix-departure-time">
        <InputGroup
          disabled={pending}
          id="matrix-departure-time"
          onChange={(event) =>
            onChange({ ...draft, departureTime: event.target.value })
          }
          type="datetime-local"
          value={draft.departureTime}
        />
      </FormGroup>

      <details className="matrix-options">
        <summary>Request Options</summary>
        <div className="matrix-options-grid">
          <FormGroup label="languageCode" labelFor="matrix-language-code">
            <InputGroup
              disabled={pending}
              id="matrix-language-code"
              onChange={(event) =>
                onChange({ ...draft, languageCode: event.target.value })
              }
              placeholder="ja"
              value={draft.languageCode}
            />
          </FormGroup>
          <FormGroup label="regionCode" labelFor="matrix-region-code">
            <InputGroup
              disabled={pending}
              id="matrix-region-code"
              onChange={(event) =>
                onChange({ ...draft, regionCode: event.target.value })
              }
              placeholder="JP"
              value={draft.regionCode}
            />
          </FormGroup>
          <FormGroup
            label="routingPreference"
            labelFor="matrix-routing-preference"
          >
            <HTMLSelect
              disabled={pending || draft.mode !== 'DRIVING'}
              fill
              id="matrix-routing-preference"
              onChange={(event) =>
                onChange({ ...draft, routingPreference: event.target.value })
              }
              options={[
                { value: '', label: 'Provider default' },
                { value: 'TRAFFIC_AWARE', label: 'TRAFFIC_AWARE' },
                {
                  value: 'TRAFFIC_AWARE_OPTIMAL',
                  label: 'TRAFFIC_AWARE_OPTIMAL',
                },
                { value: 'TRAFFIC_UNAWARE', label: 'TRAFFIC_UNAWARE' },
              ]}
              value={draft.routingPreference}
            />
          </FormGroup>
          <FormGroup label="units" labelFor="matrix-units">
            <HTMLSelect
              disabled={pending}
              fill
              id="matrix-units"
              onChange={(event) =>
                onChange({ ...draft, units: event.target.value })
              }
              options={[
                { value: '', label: 'Provider default' },
                { value: 'METRIC', label: 'METRIC' },
                { value: 'IMPERIAL', label: 'IMPERIAL' },
              ]}
              value={draft.units}
            />
          </FormGroup>
        </div>
      </details>

      <Callout compact icon="shield" intent={Intent.NONE}>
        Provider는 server 설정을 사용하며 API key는 browser로 전달되지 않습니다.
      </Callout>

      {validationError && (
        <Callout compact intent={Intent.DANGER} title="Invalid matrix request">
          {validationError}
        </Callout>
      )}

      <ButtonGroup className="route-playground-actions" fill>
        <Button
          icon="play"
          intent={Intent.PRIMARY}
          loading={pending}
          onClick={onRun}
        >
          Run Matrix Query
        </Button>
      </ButtonGroup>
    </Card>
  );
}
