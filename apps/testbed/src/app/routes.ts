export type AppRoute = 'route' | 'ai' | 'status';

export interface RouteDefinition {
  id: AppRoute;
  label: string;
  path: string;
  icon: 'route' | 'predictive-analysis' | 'pulse';
}

export const APP_ROUTES: RouteDefinition[] = [
  { id: 'route', label: '경로 캐시', path: '/route', icon: 'route' },
  { id: 'ai', label: 'AI 캐시', path: '/ai', icon: 'predictive-analysis' },
  { id: 'status', label: '상태', path: '/status', icon: 'pulse' },
];

export function routeFromPath(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/$/, '') || '/';
  if (normalized === '/route' || normalized.startsWith('/route/')) {
    return 'route';
  }
  return APP_ROUTES.find((route) => route.path === normalized)?.id ?? 'route';
}

export function getRouteDefinition(routeId: AppRoute): RouteDefinition {
  return APP_ROUTES.find((route) => route.id === routeId) ?? APP_ROUTES[0]!;
}
