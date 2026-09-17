import { Button, Callout, Intent, Tag } from '@blueprintjs/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

import type { RouteDraftLocation } from './playground-types';
import {
  getRouteLocationDisplayName,
  getRouteLocationRole,
  getRouteLocationRoleLabel,
  insertLocationBeforeDestination,
  keyboardReorderTarget,
  MAX_ROUTE_LOCATIONS,
  removeRouteLocation,
  reorderRouteLocations,
} from './route-locations';
import { RouteLocationInput } from './RouteLocationInput';

const AUTO_SCROLL_EDGE = 48;
const MAXIMUM_AUTO_SCROLL_SPEED = 12;

interface DragState {
  locationId: string;
  pointerId: number;
  sourceIndex: number;
  targetIndex: number;
}

interface ReorderControls {
  dragState: DragState | null;
  onPointerDown: (
    locationId: string,
    sourceIndex: number,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (
    locationId: string,
    sourceIndex: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
}

export function RouteLocationList({
  locations,
  disabled = false,
  onChange,
}: {
  locations: RouteDraftLocation[];
  disabled?: boolean;
  onChange: (locations: RouteDraftLocation[]) => void;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const reorder = useLocationReorder({
    locations,
    disabled,
    scrollRef,
    onReorder: (locationId, targetIndex) => {
      const next = reorderRouteLocations(locations, locationId, targetIndex);
      if (next !== locations) onChange(next);
    },
  });
  const dropIndicator = getDropIndicator(locations, reorder.dragState);

  return (
    <section className="route-location-list-section">
      <div className="route-playground-field-heading">
        <strong>위치</strong>
        <span>
          {locations.length}/{MAX_ROUTE_LOCATIONS}
        </span>
      </div>
      {disabled && (
        <Callout className="route-location-list-disabled" compact>
          요청 실행 중이거나 원본 JSON을 직접 편집하는 동안에는 위치를 변경할 수
          없습니다.
        </Callout>
      )}
      <ol className="route-location-list" ref={scrollRef}>
        {locations.map((item, index) => {
          const role = getRouteLocationRole(index, locations.length);
          const dragging = reorder.dragState?.locationId === item.id;
          const indicatorPosition =
            dropIndicator?.locationId === item.id
              ? dropIndicator.position
              : null;
          const displayName = getRouteLocationDisplayName(
            item.location,
            `위치 ${index + 1}`,
          );
          return (
            <li
              className={`route-location-list-row${dragging ? ' is-dragging' : ''}${indicatorPosition ? ` is-drop-${indicatorPosition}` : ''}`}
              data-route-location-id={item.id}
              key={item.id}
            >
              <RouteLocationDragHandle
                disabled={disabled}
                dragging={dragging}
                locationName={displayName}
                onKeyDown={(event) => reorder.onKeyDown(item.id, index, event)}
                onLostPointerCapture={reorder.onLostPointerCapture}
                onPointerCancel={reorder.onPointerCancel}
                onPointerDown={(event) =>
                  reorder.onPointerDown(item.id, index, event)
                }
                onPointerMove={reorder.onPointerMove}
                onPointerUp={reorder.onPointerUp}
              />
              <span className="route-location-order" aria-hidden="true">
                {index + 1}
              </span>
              <div className="route-location-row-content">
                <div className="route-location-row-heading">
                  <Tag
                    intent={
                      role === 'origin'
                        ? Intent.SUCCESS
                        : role === 'destination'
                          ? Intent.DANGER
                          : Intent.PRIMARY
                    }
                    minimal
                  >
                    {getRouteLocationRoleLabel(role)}
                  </Tag>
                  <Button
                    aria-label={`${displayName} 삭제`}
                    disabled={disabled}
                    icon="cross"
                    onClick={() =>
                      onChange(removeRouteLocation(locations, item.id))
                    }
                    size="small"
                    variant="minimal"
                  />
                </div>
                <RouteLocationInput
                  disabled={disabled}
                  label={`위치 ${index + 1}`}
                  onChange={(location) =>
                    onChange(
                      locations.map((current) =>
                        current.id === item.id
                          ? { ...current, location }
                          : current,
                      ),
                    )
                  }
                  value={item.location}
                />
              </div>
            </li>
          );
        })}
        {locations.length === 0 && (
          <li className="route-location-list-empty">
            출발지와 도착지를 추가하세요.
          </li>
        )}
      </ol>
      <Button
        disabled={disabled || locations.length >= MAX_ROUTE_LOCATIONS}
        fill
        icon="plus"
        onClick={() => onChange(insertLocationBeforeDestination(locations))}
        size="small"
        variant="outlined"
      >
        위치 추가
      </Button>
    </section>
  );
}

function RouteLocationDragHandle({
  locationName,
  dragging,
  disabled,
  ...events
}: {
  locationName: string;
  dragging: boolean;
  disabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      {...events}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      aria-label={`${locationName} 순서 변경`}
      className={`route-location-drag-handle${dragging ? ' is-dragging' : ''}`}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      title="드래그하거나 Alt + ↑/↓ 키로 순서 변경"
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 16 20">
        <circle cx="5" cy="5" r="1.25" />
        <circle cx="11" cy="5" r="1.25" />
        <circle cx="5" cy="10" r="1.25" />
        <circle cx="11" cy="10" r="1.25" />
        <circle cx="5" cy="15" r="1.25" />
        <circle cx="11" cy="15" r="1.25" />
      </svg>
    </button>
  );
}

function useLocationReorder({
  locations,
  disabled,
  scrollRef,
  onReorder,
}: {
  locations: RouteDraftLocation[];
  disabled: boolean;
  scrollRef: RefObject<HTMLOListElement | null>;
  onReorder: (locationId: string, targetIndex: number) => void;
}): ReorderControls {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const pointerYRef = useRef(0);
  const capturedHandleRef = useRef<HTMLButtonElement | null>(null);
  const frameRef = useRef(0);

  const updateDragState = useCallback((next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  const cancelDrag = useCallback(() => {
    const current = dragStateRef.current;
    if (!current) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    updateDragState(null);

    const handle = capturedHandleRef.current;
    capturedHandleRef.current = null;
    if (handle?.hasPointerCapture(current.pointerId)) {
      handle.releasePointerCapture(current.pointerId);
    }
  }, [updateDragState]);

  const onPointerDown = useCallback(
    (
      locationId: string,
      sourceIndex: number,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      capturedHandleRef.current = event.currentTarget;
      pointerYRef.current = event.clientY;
      updateDragState({
        locationId,
        pointerId: event.pointerId,
        sourceIndex,
        targetIndex: sourceIndex,
      });
    },
    [disabled, updateDragState],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const current = dragStateRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      pointerYRef.current = event.clientY;
    },
    [],
  );

  const finishPointerDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
      const current = dragStateRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const targetIndex = getTargetIndex(
        scrollRef.current,
        current.locationId,
        event.clientY,
      );
      cancelDrag();
      if (commit && targetIndex !== null) {
        onReorder(current.locationId, targetIndex);
      }
    },
    [cancelDrag, onReorder, scrollRef],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => finishPointerDrag(event, true),
    [finishPointerDrag],
  );
  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => finishPointerDrag(event, false),
    [finishPointerDrag],
  );
  const onLostPointerCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (dragStateRef.current?.pointerId === event.pointerId) cancelDrag();
    },
    [cancelDrag],
  );
  const onKeyDown = useCallback(
    (
      locationId: string,
      sourceIndex: number,
      event: KeyboardEvent<HTMLButtonElement>,
    ) => {
      const targetIndex = keyboardReorderTarget(
        sourceIndex,
        event.key,
        event.altKey,
        disabled,
      );
      if (targetIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      onReorder(locationId, targetIndex);
    },
    [disabled, onReorder],
  );

  const draggedLocationId = dragState?.locationId;
  useEffect(() => {
    if (!draggedLocationId) return;
    const updatePreview = () => {
      frameRef.current = 0;
      const current = dragStateRef.current;
      if (!current) return;
      autoScroll(scrollRef.current, pointerYRef.current);
      const targetIndex = getTargetIndex(
        scrollRef.current,
        current.locationId,
        pointerYRef.current,
      );
      if (targetIndex !== null && targetIndex !== current.targetIndex) {
        updateDragState({ ...current, targetIndex });
      }
      frameRef.current = requestAnimationFrame(updatePreview);
    };
    frameRef.current = requestAnimationFrame(updatePreview);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draggedLocationId, scrollRef, updateDragState]);

  useEffect(() => {
    const current = dragStateRef.current;
    if (
      current &&
      (disabled || !locations.some((item) => item.id === current.locationId))
    ) {
      cancelDrag();
    }
  }, [cancelDrag, disabled, locations]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      const current = dragStateRef.current;
      const handle = capturedHandleRef.current;
      dragStateRef.current = null;
      capturedHandleRef.current = null;
      if (current && handle?.hasPointerCapture(current.pointerId)) {
        handle.releasePointerCapture(current.pointerId);
      }
    },
    [],
  );

  return {
    dragState,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
  };
}

function getTargetIndex(
  container: HTMLElement | null,
  locationId: string,
  pointerY: number,
): number | null {
  if (!container) return null;
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>('.route-location-list-row'),
  ).filter((row) => row.dataset.routeLocationId !== locationId);
  if (!rows.length) return 0;
  const beforeIndex = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return pointerY < rect.top + rect.height / 2;
  });
  return beforeIndex < 0 ? rows.length : beforeIndex;
}

function autoScroll(container: HTMLElement | null, pointerY: number) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  let direction = 0;
  let intensity = 0;
  if (pointerY < rect.top + AUTO_SCROLL_EDGE) {
    direction = -1;
    intensity = Math.min(
      1,
      (rect.top + AUTO_SCROLL_EDGE - pointerY) / AUTO_SCROLL_EDGE,
    );
  } else if (pointerY > rect.bottom - AUTO_SCROLL_EDGE) {
    direction = 1;
    intensity = Math.min(
      1,
      (pointerY - (rect.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE,
    );
  }
  if (direction) {
    container.scrollTop +=
      direction * Math.max(2, MAXIMUM_AUTO_SCROLL_SPEED * intensity);
  }
}

function getDropIndicator(
  locations: RouteDraftLocation[],
  dragState: DragState | null,
): { locationId: string; position: 'before' | 'after' } | null {
  if (!dragState || dragState.targetIndex === dragState.sourceIndex)
    return null;
  const stationary = locations.filter(
    (item) => item.id !== dragState.locationId,
  );
  const next = stationary[dragState.targetIndex];
  if (next) return { locationId: next.id, position: 'before' };
  const last = stationary.at(-1);
  return last ? { locationId: last.id, position: 'after' } : null;
}
