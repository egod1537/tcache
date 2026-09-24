import { Tab, Tabs, type TabId } from '@blueprintjs/core';

export type RouteTab = 'route' | 'matrix' | 'jobs' | 'cache' | 'analytics';

export const ROUTE_TABS: Array<{
  id: RouteTab;
  label: string;
  path: string;
}> = [
  { id: 'route', label: 'Route Query', path: '/route' },
  { id: 'matrix', label: 'Matrix Query', path: '/route/matrix' },
  { id: 'jobs', label: 'Jobs', path: '/route/jobs' },
  { id: 'cache', label: 'Cache', path: '/route/cache' },
  { id: 'analytics', label: 'Analytics', path: '/route/analytics' },
];

interface RouteTabsProps {
  activeTab: RouteTab;
  onNavigate: (tab: RouteTab) => void;
}

export function RouteTabs({ activeTab, onNavigate }: RouteTabsProps) {
  return (
    <nav className="route-section-tabs" aria-label="경로 도구">
      <Tabs
        id="route-section-tabs"
        onChange={(tab: TabId) => onNavigate(tab as RouteTab)}
        selectedTabId={activeTab}
      >
        {ROUTE_TABS.map((tab) => (
          <Tab id={tab.id} key={tab.id} title={tab.label} />
        ))}
      </Tabs>
    </nav>
  );
}

export function routeTabFromPath(pathname: string): RouteTab {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return ROUTE_TABS.find((tab) => tab.path === normalized)?.id ?? 'route';
}

export function routeTabPath(tab: RouteTab) {
  return ROUTE_TABS.find((candidate) => candidate.id === tab)?.path ?? '/route';
}
