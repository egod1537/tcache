import { Button, InputGroup, Tag } from '@blueprintjs/core';
import { useState, type DragEvent } from 'react';

import { RouteLocationInput } from '../route/RouteLocationInput';
import {
  MAX_MATRIX_LOCATIONS,
  addMatrixLocation,
  reorderMatrixLocations,
  type MatrixDraftLocation,
} from './matrix-types';

export function MatrixLocationEditor({
  locations,
  disabled,
  onChange,
}: {
  locations: MatrixDraftLocation[];
  disabled: boolean;
  onChange: (locations: MatrixDraftLocation[]) => void;
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  function drop(targetKey: string, event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    if (draggingKey) {
      onChange(reorderMatrixLocations(locations, draggingKey, targetKey));
    }
    setDraggingKey(null);
  }

  return (
    <section className="matrix-location-editor">
      <div className="route-playground-field-heading">
        <strong>Locations</strong>
        <span>
          {locations.length}/{MAX_MATRIX_LOCATIONS}
        </span>
      </div>
      <ol className="matrix-location-list">
        {locations.map((item, index) => (
          <li
            className={`matrix-location-row${draggingKey === item.key ? ' is-dragging' : ''}`}
            draggable={!disabled}
            key={item.key}
            onDragEnd={() => setDraggingKey(null)}
            onDragOver={(event) => event.preventDefault()}
            onDragStart={() => setDraggingKey(item.key)}
            onDrop={(event) => drop(item.key, event)}
          >
            <button
              aria-label={`${item.id || `Location ${index + 1}`} 순서 변경`}
              className="matrix-drag-handle"
              disabled={disabled}
              title="드래그해 순서 변경"
              type="button"
            >
              ⋮⋮
            </button>
            <span className="route-location-order">{index + 1}</span>
            <div className="matrix-location-content">
              {item.name && (
                <div className="matrix-location-place-name">{item.name}</div>
              )}
              <div className="matrix-location-id-row">
                <Tag minimal>Matrix ID</Tag>
                <InputGroup
                  aria-label={`Location ${index + 1} ID`}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      locations.map((location) =>
                        location.key === item.key
                          ? { ...location, id: event.target.value }
                          : location,
                      ),
                    )
                  }
                  placeholder="A"
                  value={item.id}
                />
                <Button
                  aria-label={`${item.id || `Location ${index + 1}`} 삭제`}
                  disabled={disabled}
                  icon="cross"
                  onClick={() =>
                    onChange(locations.filter(({ key }) => key !== item.key))
                  }
                  size="small"
                  variant="minimal"
                />
              </div>
              <RouteLocationInput
                disabled={disabled}
                label="Locator"
                onChange={(location) =>
                  onChange(
                    locations.map((current) =>
                      current.key === item.key
                        ? { ...current, location }
                        : current,
                    ),
                  )
                }
                value={item.location}
              />
            </div>
          </li>
        ))}
        {!locations.length && (
          <li className="route-location-list-empty">
            Location을 2개 이상 추가하세요.
          </li>
        )}
      </ol>
      <Button
        disabled={disabled || locations.length >= MAX_MATRIX_LOCATIONS}
        fill
        icon="plus"
        onClick={() => onChange(addMatrixLocation(locations))}
        size="small"
        variant="outlined"
      >
        Add Location
      </Button>
    </section>
  );
}
