import {
  Alignment,
  Button,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tooltip,
} from '@blueprintjs/core';
import { DatabaseIcon } from '@blueprintjs/icons/lib/esm/next/generated/components/database';

import type { CheckState } from '../../api/useTcacheStatus';
import type { AppRoute } from '../../app/routes';
import type { ThemeMode } from '../../theme/theme';
import { ThemeControl } from '../../theme/ThemeControl';
import { CommitInfo } from '../status/CommitInfo';
import { HealthTag } from '../status/HealthTag';
import { SystemNavigation } from './SystemNavigation';

interface AppHeaderProps {
  currentRoute: AppRoute;
  currentSystem: string;
  health: CheckState;
  healthRefreshing: boolean;
  themeMode: ThemeMode;
  version: string | undefined;
  onNavigate: (route: AppRoute) => void;
  onRefreshHealth: () => void;
  onThemeChange: (mode: ThemeMode) => void;
}

export function AppHeader({
  currentRoute,
  currentSystem,
  health,
  healthRefreshing,
  themeMode,
  version,
  onNavigate,
  onRefreshHealth,
  onThemeChange,
}: AppHeaderProps) {
  return (
    <Navbar className="app-navbar">
      <NavbarGroup align={Alignment.START} className="navbar-start">
        <NavbarHeading className="navbar-brand">
          <DatabaseIcon size={18} />
          <strong>tcache</strong>
          <span className="brand-separator">/</span>
          <span>{currentSystem}</span>
        </NavbarHeading>
        <NavbarDivider />
        <SystemNavigation currentRoute={currentRoute} onNavigate={onNavigate} />
      </NavbarGroup>
      <NavbarGroup align={Alignment.END} className="navbar-end">
        <HealthTag label="Server" state={health} />
        <Tooltip content="Refresh service health" placement="bottom">
          <Button
            aria-label="Refresh service health"
            disabled={healthRefreshing}
            icon="refresh"
            loading={healthRefreshing}
            onClick={onRefreshHealth}
            variant="minimal"
          />
        </Tooltip>
        <CommitInfo version={version} />
        <ThemeControl mode={themeMode} onChange={onThemeChange} />
      </NavbarGroup>
    </Navbar>
  );
}
