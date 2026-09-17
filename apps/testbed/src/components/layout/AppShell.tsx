import { Classes } from '@blueprintjs/core';
import type { ReactNode } from 'react';

import type { CheckState } from '../../api/useTcacheStatus';
import type { AppRoute } from '../../app/routes';
import type { ResolvedTheme, ThemeMode } from '../../theme/theme';
import { AppHeader } from './AppHeader';

interface AppShellProps {
  children: ReactNode;
  currentRoute: AppRoute;
  currentSystem: string;
  health: CheckState;
  healthRefreshing: boolean;
  resolvedTheme: ResolvedTheme;
  themeMode: ThemeMode;
  version: string | undefined;
  onNavigate: (route: AppRoute) => void;
  onRefreshHealth: () => void;
  onThemeChange: (mode: ThemeMode) => void;
}

export function AppShell({
  children,
  currentRoute,
  currentSystem,
  health,
  healthRefreshing,
  resolvedTheme,
  themeMode,
  version,
  onNavigate,
  onRefreshHealth,
  onThemeChange,
}: AppShellProps) {
  return (
    <div
      className={`app-shell ${resolvedTheme === 'dark' ? Classes.DARK : ''}`}
      data-theme={resolvedTheme}
    >
      <AppHeader
        currentRoute={currentRoute}
        currentSystem={currentSystem}
        health={health}
        healthRefreshing={healthRefreshing}
        onNavigate={onNavigate}
        onRefreshHealth={onRefreshHealth}
        onThemeChange={onThemeChange}
        themeMode={themeMode}
        version={version}
      />
      {children}
    </div>
  );
}
