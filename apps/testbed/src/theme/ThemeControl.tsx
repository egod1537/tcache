import {
  Button,
  Menu,
  MenuItem,
  PopoverAnimation,
  PopoverNext,
} from '@blueprintjs/core';

import type { ThemeMode } from './theme';

interface ThemeControlProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const LABELS: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const ICONS: Record<ThemeMode, 'desktop' | 'flash' | 'moon'> = {
  system: 'desktop',
  light: 'flash',
  dark: 'moon',
};

export function ThemeControl({ mode, onChange }: ThemeControlProps) {
  return (
    <PopoverNext
      animation={PopoverAnimation.MINIMAL}
      content={
        <Menu aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((option) => (
            <MenuItem
              active={mode === option}
              icon={ICONS[option]}
              key={option}
              onClick={() => onChange(option)}
              text={LABELS[option]}
            />
          ))}
        </Menu>
      }
      inheritDarkTheme
      placement="bottom-end"
      usePortal
    >
      <Button
        aria-label={`Theme: ${LABELS[mode]}`}
        icon={ICONS[mode]}
        title="Change theme"
        variant="minimal"
      />
    </PopoverNext>
  );
}
