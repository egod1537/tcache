import { useCallback, useEffect, useState } from 'react';

import { getRouteDefinition, routeFromPath, type AppRoute } from './routes';

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() =>
    routeFromPath(window.location.pathname),
  );

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', getRouteDefinition('route').path);
    }

    const handlePopState = () =>
      setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    const path = getRouteDefinition(nextRoute).path;
    if (window.location.pathname !== path)
      window.history.pushState(null, '', path);
    setRoute(nextRoute);
  }, []);

  return { route, navigate };
}
