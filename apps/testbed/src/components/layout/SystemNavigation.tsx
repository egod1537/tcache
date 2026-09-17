import { Button } from '@blueprintjs/core';

import { APP_ROUTES, type AppRoute } from '../../app/routes';

interface SystemNavigationProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export function SystemNavigation({
  currentRoute,
  onNavigate,
}: SystemNavigationProps) {
  return (
    <nav className="system-navigation" aria-label="tcache 시스템">
      {APP_ROUTES.map((route) => (
        <Button
          active={currentRoute === route.id}
          aria-current={currentRoute === route.id ? 'page' : undefined}
          icon={route.icon}
          key={route.id}
          onClick={() => onNavigate(route.id)}
          size="small"
          variant="minimal"
        >
          {route.label}
        </Button>
      ))}
    </nav>
  );
}
