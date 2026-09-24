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
        <InputGroup
          aria-label={`${label} 이름`}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="장소 이름 (선택)"
          value={value.name}
        />
        <details className="route-location-debug-fields" open>
          <summary>위치 상세 / Provider ID</summary>
          <div className="route-playground-location-fields">
            <InputGroup
              aria-label={`${label} 주소`}
              disabled={disabled}
              id={`${id}-value`}
              onChange={(event) =>
                onChange({ ...value, address: event.target.value })
              }
              placeholder="주소"
              value={value.address}
            />
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
            <InputGroup
              aria-label={`${label} Google Place ID`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, placeId: event.target.value })
              }
              placeholder="Google Place ID (선택)"
              value={value.placeId}
            />
            <InputGroup
              aria-label={`${label} Kakao Place ID`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, kakaoPlaceId: event.target.value })
              }
              placeholder="Kakao Place ID (선택)"
              value={value.kakaoPlaceId}
            />
            <InputGroup
              aria-label={`${label} NAVITIME ID`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, navitimeId: event.target.value })
              }
              placeholder="NAVITIME node/station ID (선택)"
              value={value.navitimeId}
            />
            <InputGroup
              aria-label={`${label} Ekispert ID`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, ekispertId: event.target.value })
              }
              placeholder="Ekispert station ID (선택)"
              value={value.ekispertId}
            />
          </div>
        </details>
      </div>
    </FormGroup>
  );
}
