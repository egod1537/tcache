import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  Intent,
  Switch,
  Tag,
  HTMLSelect,
} from '@blueprintjs/core';

import {
  ROUTE_PLAYGROUND_PRESETS,
  type RouteRequestDraft,
  type ValidationState,
} from './playground-types';
import { RouteAdvancedOptions } from './RouteAdvancedOptions';
import { RouteLocationList } from './RouteLocationList';
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
  selectedPresetId,
  onSelectPreset,
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
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
}) {
  return (
    <Card className="route-playground-request-panel" compact elevation={1}>
      <div className="route-playground-panel-heading">
        <div>
          <h2 className={Classes.HEADING}>경로 요청</h2>
          <p className={Classes.TEXT_MUTED}>
            Route Job이 국가와 이동수단에 맞는 provider를 선택합니다.
          </p>
        </div>
        {validation.state === 'valid' && (
          <Tag icon="tick" intent={Intent.SUCCESS}>
            유효함
          </Tag>
        )}
      </div>

      <HTMLSelect
        aria-label="경로 프리셋"
        disabled={pending || rawOverride !== null}
        fill
        onChange={(event) => onSelectPreset(event.target.value)}
        options={ROUTE_PLAYGROUND_PRESETS.map((preset) => ({
          value: preset.id,
          label: preset.label,
        }))}
        value={selectedPresetId}
      />

      <RouteLocationList
        disabled={pending || rawOverride !== null}
        locations={draft.locations}
        onChange={(locations) => onChange({ ...draft, locations })}
      />
      <RouteModeSelector
        disabled={pending}
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
        disabled={pending}
        label="대체 경로"
        onChange={(event) =>
          onChange({
            ...draft,
            computeAlternativeRoutes: event.currentTarget.checked,
          })
        }
      />
      <RouteAdvancedOptions
        disabled={pending}
        draft={draft}
        onChange={onChange}
        onRawOverride={onRawOverride}
        rawJson={rawJson}
        rawOverride={rawOverride}
      />

      {validation.state === 'invalid' && (
        <Callout
          compact
          intent={Intent.DANGER}
          title="요청이 올바르지 않습니다"
        >
          {validation.message}
        </Callout>
      )}

      <ButtonGroup className="route-playground-actions" fill>
        <Button disabled={pending} icon="reset" onClick={onReset}>
          초기화
        </Button>
        <Button disabled={pending} icon="tick-circle" onClick={onValidate}>
          검증
        </Button>
        <Button
          icon="play"
          intent={Intent.PRIMARY}
          loading={pending}
          onClick={onRun}
        >
          경로 실행
        </Button>
      </ButtonGroup>
    </Card>
  );
}
