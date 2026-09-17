import { useTcacheStatus } from '../api/useTcacheStatus';
import { AiCachePage } from '../../../../ai/testbed/AiCachePage';
import { RouteCachePage } from '../../../../route/testbed/RouteCachePage';
import { AppShell } from '../components/layout/AppShell';
import { StatusPage } from '../status/StatusPage';
import { useTheme, type ThemeMode } from '../theme/theme';
import { useAppRouter } from './router';
import { getRouteDefinition } from './routes';

interface AppProps {
  initialThemeMode?: ThemeMode;
}

export function App({ initialThemeMode }: AppProps) {
  const { route, navigate } = useAppRouter();
  const { mode, resolvedTheme, selectMode } = useTheme(initialThemeMode);
  const status = useTcacheStatus();
  const routeDefinition = getRouteDefinition(route);

  const page =
    route === 'ai' ? (
      <AiCachePage dark={resolvedTheme === 'dark'} status={status} />
    ) : route === 'status' ? (
      <StatusPage status={status} />
    ) : (
      <RouteCachePage dark={resolvedTheme === 'dark'} status={status} />
    );

  return (
    <AppShell
      currentRoute={route}
      currentSystem={routeDefinition.label}
      health={status.server}
      healthRefreshing={status.refreshing}
      onNavigate={navigate}
      onRefreshHealth={() => void status.refresh()}
      onThemeChange={selectMode}
      resolvedTheme={resolvedTheme}
      themeMode={mode}
      version={status.service?.version}
    >
      {page}
    </AppShell>
  );
}
