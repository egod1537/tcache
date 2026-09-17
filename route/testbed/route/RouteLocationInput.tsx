import { FormGroup, HTMLSelect, InputGroup } from '@blueprintjs/core';
import { useId } from 'react';

import type { RouteLocationDraft, RouteLocationKind } from './playground-types';

export function RouteLocationInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: RouteLocationDraft;
  onChange: (value: RouteLocationDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FormGroup label={label} labelFor={`${id}-value`}>
      <div className="route-playground-location">
        <HTMLSelect
          aria-label={`${label} 유형`}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              type: event.target.value as RouteLocationKind,
            })
          }
          options={[
            { value: 'address', label: '주소' },
            { value: 'coordinates', label: '좌표' },
            { value: 'placeId', label: 'Place ID' },
          ]}
          value={value.type}
        />
        {value.type === 'address' && (
          <InputGroup
            disabled={disabled}
            id={`${id}-value`}
            onChange={(event) =>
              onChange({ ...value, address: event.target.value })
            }
            placeholder="東京駅、日本"
            value={value.address}
          />
        )}
        {value.type === 'placeId' && (
          <InputGroup
            disabled={disabled}
            id={`${id}-value`}
            onChange={(event) =>
              onChange({ ...value, placeId: event.target.value })
            }
            placeholder="Google Place ID"
            value={value.placeId}
          />
        )}
        {value.type === 'coordinates' && (
          <div className="route-playground-coordinates">
            <InputGroup
              aria-label={`${label} 위도`}
              disabled={disabled}
              id={`${id}-value`}
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, latitude: event.target.value })
              }
              placeholder="위도"
              value={value.latitude}
            />
            <InputGroup
              aria-label={`${label} 경도`}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, longitude: event.target.value })
              }
              placeholder="경도"
              value={value.longitude}
            />
          </div>
        )}
      </div>
    </FormGroup>
  );
}
