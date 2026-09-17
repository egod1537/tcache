import { FormGroup, HTMLSelect, InputGroup } from '@blueprintjs/core';
import { useId } from 'react';

import type { RouteLocationDraft, RouteLocationKind } from './playground-types';

export function RouteLocationInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RouteLocationDraft;
  onChange: (value: RouteLocationDraft) => void;
}) {
  const id = useId();
  return (
    <FormGroup label={label} labelFor={`${id}-value`}>
      <div className="route-playground-location">
        <HTMLSelect
          aria-label={`${label} type`}
          onChange={(event) =>
            onChange({
              ...value,
              type: event.target.value as RouteLocationKind,
            })
          }
          options={[
            { value: 'address', label: 'Address' },
            { value: 'coordinates', label: 'Coordinates' },
            { value: 'placeId', label: 'Place ID' },
          ]}
          value={value.type}
        />
        {value.type === 'address' && (
          <InputGroup
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
              aria-label={`${label} latitude`}
              id={`${id}-value`}
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, latitude: event.target.value })
              }
              placeholder="Latitude"
              value={value.latitude}
            />
            <InputGroup
              aria-label={`${label} longitude`}
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, longitude: event.target.value })
              }
              placeholder="Longitude"
              value={value.longitude}
            />
          </div>
        )}
      </div>
    </FormGroup>
  );
}
