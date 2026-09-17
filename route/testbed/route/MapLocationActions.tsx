import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  Intent,
  Tag,
} from '@blueprintjs/core';

import type {
  MapLocationSelection,
  MapLocationTarget,
} from './map-location-selection';

export function MapLocationActions({
  selection,
  error,
  onApply,
  onCancel,
}: {
  selection: MapLocationSelection;
  error: string | null | undefined;
  onApply: (target: MapLocationTarget) => void;
  onCancel: () => void;
}) {
  const locationLabel =
    selection.displayName ??
    (selection.placeId ? 'Google 지도 장소' : '선택한 좌표');

  return (
    <Card
      aria-label="선택한 지도 위치"
      className="route-map-selection-card"
      compact
      elevation={3}
      role="dialog"
    >
      <div className="route-map-selection-heading">
        <div>
          <Tag icon={selection.placeId ? 'map-marker' : 'locate'} minimal>
            {selection.placeId ? 'Place ID' : '좌표'}
          </Tag>
          <strong>{locationLabel}</strong>
        </div>
        <Button
          aria-label="지도 위치 선택 취소"
          icon="cross"
          onClick={onCancel}
          size="small"
          variant="minimal"
        />
      </div>
      {selection.placeId && (
        <code className={Classes.MONOSPACE_TEXT}>{selection.placeId}</code>
      )}
      <span className={`${Classes.TEXT_MUTED} route-map-selection-coordinate`}>
        {selection.lat.toFixed(6)}, {selection.lng.toFixed(6)}
      </span>
      {error && (
        <Callout compact intent={Intent.WARNING}>
          {error}
        </Callout>
      )}
      <ButtonGroup fill vertical>
        <Button icon="map-marker" onClick={() => onApply('origin')}>
          출발지로 설정
        </Button>
        <Button icon="plus" onClick={() => onApply('stop')}>
          경유지로 추가
        </Button>
        <Button icon="flag" onClick={() => onApply('destination')}>
          도착지로 설정
        </Button>
      </ButtonGroup>
      <Button fill onClick={onCancel} size="small" variant="minimal">
        취소
      </Button>
    </Card>
  );
}
