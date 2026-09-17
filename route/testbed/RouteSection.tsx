import { useEffect, useState } from 'react';

import type { TcacheStatusState } from '../../apps/testbed/src/api/useTcacheStatus';
import { RouteAnalyticsPage } from './analytics/RouteAnalyticsPage';
import { RouteCacheExplorerPage } from './cache/RouteCacheExplorerPage';
import { RouteJobsPage } from './jobs/RouteJobsPage';
import { RoutePlaygroundPage } from './route/RoutePlaygroundPage';
import {
  RouteTabs,
  routeTabFromPath,
  routeTabPath,
  type RouteTab,
} from './RouteTabs';

interface RouteSectionProps {
  dark: boolean;
  status: TcacheStatusState;
}

export function RouteSection({ dark, status }: RouteSectionProps) {
  const [activeTab, setActiveTab] = useState<RouteTab>(() =>
    routeTabFromPath(window.location.pathname),
  );
  const [visited, setVisited] = useState<Set<RouteTab>>(
    () => new Set([routeTabFromPath(window.location.pathname)]),
  );
  const [requestedJob, setRequestedJob] = useState<{
    jobId: string;
    sequence: number;
  } | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      const tab = routeTabFromPath(window.location.pathname);
      setActiveTab(tab);
      setVisited((current) => new Set(current).add(tab));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(tab: RouteTab) {
    const path = routeTabPath(tab);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setActiveTab(tab);
    setVisited((current) => new Set(current).add(tab));
  }

  function openJob(jobId: string) {
    setRequestedJob((current) => ({
      jobId,
      sequence: (current?.sequence ?? 0) + 1,
    }));
    navigate('jobs');
  }

  return (
    <section className="route-section">
      <RouteTabs activeTab={activeTab} onNavigate={navigate} />
      {visited.has('route') && (
        <div hidden={activeTab !== 'route'}>
          <RoutePlaygroundPage dark={dark} />
        </div>
      )}
      {visited.has('jobs') && (
        <div hidden={activeTab !== 'jobs'}>
          <RouteJobsPage
            dark={dark}
            requestedJobId={requestedJob?.jobId ?? null}
            requestedJobSequence={requestedJob?.sequence ?? 0}
            status={status}
          />
        </div>
      )}
      {visited.has('cache') && (
        <div hidden={activeTab !== 'cache'}>
          <RouteCacheExplorerPage />
        </div>
      )}
      {visited.has('analytics') && (
        <div hidden={activeTab !== 'analytics'}>
          <RouteAnalyticsPage onSelectJob={openJob} />
        </div>
      )}
    </section>
  );
}
