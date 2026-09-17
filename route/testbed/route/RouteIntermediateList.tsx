import { Button, Classes } from '@blueprintjs/core';

import {
  createLocationDraft,
  type RouteLocationDraft,
} from './playground-types';
import { RouteLocationInput } from './RouteLocationInput';

export function RouteIntermediateList({
  values,
  onChange,
}: {
  values: RouteLocationDraft[];
  onChange: (values: RouteLocationDraft[]) => void;
}) {
  return (
    <section className="route-playground-intermediates">
      <div className="route-playground-field-heading">
        <strong>경유지</strong>
        <span className={Classes.TEXT_MUTED}>{values.length}/25</span>
      </div>
      {values.map((value, index) => (
        <div className="route-playground-intermediate" key={index}>
          <RouteLocationInput
            label={`경유지 ${index + 1}`}
            onChange={(next) =>
              onChange(
                values.map((current, itemIndex) =>
                  itemIndex === index ? next : current,
                ),
              )
            }
            value={value}
          />
          <Button
            aria-label={`경유지 ${index + 1} 삭제`}
            icon="cross"
            onClick={() =>
              onChange(values.filter((_, itemIndex) => itemIndex !== index))
            }
            size="small"
            variant="minimal"
          />
        </div>
      ))}
      <Button
        disabled={values.length >= 25}
        fill
        icon="plus"
        onClick={() => onChange([...values, createLocationDraft()])}
        size="small"
        variant="outlined"
      >
        경유지 추가
      </Button>
    </section>
  );
}
