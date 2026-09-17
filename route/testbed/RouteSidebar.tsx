import { Button, Card, Classes, Divider, Intent } from '@blueprintjs/core';

import type { RouteJobView } from '../../apps/testbed/src/api/client';
import { RouteJobList } from './components/RouteJobList';

interface RouteSidebarProps {
  jobs: RouteJobView[];
  selectedJobId: string | null;
  refreshing: boolean;
  refreshError: boolean;
  onNewRequest: () => void;
  onRefresh: () => void;
  onSelect: (jobId: string) => void;
}

export function RouteSidebar({
  jobs,
  selectedJobId,
  refreshing,
  refreshError,
  onNewRequest,
  onRefresh,
  onSelect,
}: RouteSidebarProps) {
  return (
    <Card className="cache-sidebar" compact elevation={1}>
      <div className="panel-heading">
        <div>
          <h1 className={Classes.HEADING}>Route Jobs</h1>
          <span className={Classes.TEXT_MUTED}>{jobs.length} recent Jobs</span>
        </div>
        <div className="sidebar-actions">
          <Button
            aria-label="Refresh Route Jobs"
            disabled={refreshing}
            icon="refresh"
            intent={refreshError ? Intent.WARNING : Intent.NONE}
            loading={refreshing}
            onClick={onRefresh}
            size="small"
            title="Refresh Route Jobs"
            variant="minimal"
          />
          <Button icon="plus" intent={Intent.PRIMARY} onClick={onNewRequest}>
            New Request
          </Button>
        </div>
      </div>
      <Divider />
      <RouteJobList
        jobs={jobs}
        onSelect={onSelect}
        selectedJobId={selectedJobId}
      />
    </Card>
  );
}
