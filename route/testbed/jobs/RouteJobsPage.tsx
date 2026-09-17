import type { TcacheStatusState } from '../../../apps/testbed/src/api/useTcacheStatus';
import { RouteCachePage } from '../RouteCachePage';

interface RouteJobsPageProps {
  dark: boolean;
  status: TcacheStatusState;
  requestedJobId: string | null;
  requestedJobSequence: number;
}

export function RouteJobsPage({
  dark,
  status,
  requestedJobId,
  requestedJobSequence,
}: RouteJobsPageProps) {
  return (
    <RouteCachePage
      dark={dark}
      requestedJobId={requestedJobId}
      requestedJobSequence={requestedJobSequence}
      status={status}
    />
  );
}
