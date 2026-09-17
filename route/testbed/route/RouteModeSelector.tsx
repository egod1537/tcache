import { Button, ButtonGroup, FormGroup } from '@blueprintjs/core';

import type { RouteTravelMode } from '../../../apps/testbed/src/api/client';
import { ROUTE_MODES } from './playground-types';

export function RouteModeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: RouteTravelMode;
  onChange: (mode: RouteTravelMode) => void;
  disabled?: boolean;
}) {
  return (
    <FormGroup label="이동 수단">
      <ButtonGroup className="route-mode-selector" fill>
        {ROUTE_MODES.map((mode) => (
          <Button
            active={value === mode.value}
            aria-pressed={value === mode.value}
            disabled={disabled}
            intent={value === mode.value ? 'primary' : 'none'}
            key={mode.value}
            onClick={() => onChange(mode.value)}
            size="small"
            variant={value === mode.value ? 'solid' : 'minimal'}
          >
            {mode.label}
          </Button>
        ))}
      </ButtonGroup>
    </FormGroup>
  );
}
