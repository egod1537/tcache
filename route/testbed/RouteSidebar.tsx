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
          <h1 className={Classes.HEADING}>경로 작업</h1>
          <span className={Classes.TEXT_MUTED}>최근 작업 {jobs.length}개</span>
        </div>
        <div className="sidebar-actions">
          <Button
            aria-label="경로 작업 새로고침"
            disabled={refreshing}
            icon="refresh"
            intent={refreshError ? Intent.WARNING : Intent.NONE}
            loading={refreshing}
            onClick={onRefresh}
            size="small"
            title="경로 작업 새로고침"
            variant="minimal"
          />
          <Button icon="plus" intent={Intent.PRIMARY} onClick={onNewRequest}>
            새 요청
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
