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
          <h2 className={Classes.HEADING}>경로 요청</h2>
          <p className={Classes.TEXT_MUTED}>
            Google Routes 백엔드에 직접 요청합니다.
          </p>
        </div>
        {validation.state === 'valid' && (
          <Tag icon="tick" intent={Intent.SUCCESS}>
            유효함
          </Tag>
        )}
      </div>

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
