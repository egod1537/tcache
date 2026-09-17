import { Button, Card, Classes, Divider, Intent } from '@blueprintjs/core';

import type { AiJobView } from '../api/client';
import { AiJobList } from './components/AiJobList';

interface AiSidebarProps {
  jobs: AiJobView[];
  selectedJobId: string | null;
  refreshing: boolean;
  refreshError: boolean;
  onNewJob: () => void;
  onRefresh: () => void;
  onSelect: (jobId: string) => void;
}

export function AiSidebar({
  jobs,
  selectedJobId,
  refreshing,
  refreshError,
  onNewJob,
  onRefresh,
  onSelect,
}: AiSidebarProps) {
  return (
    <Card className="cache-sidebar" compact elevation={1}>
      <div className="panel-heading">
        <div>
          <h1 className={Classes.HEADING}>AI Jobs</h1>
          <span className={Classes.TEXT_MUTED}>{jobs.length} recent Jobs</span>
        </div>
        <div className="sidebar-actions">
          <Button
            aria-label="Refresh AI Jobs"
            disabled={refreshing}
            icon="refresh"
            intent={refreshError ? Intent.WARNING : Intent.NONE}
            loading={refreshing}
            onClick={onRefresh}
            size="small"
            title="Refresh AI Jobs"
            variant="minimal"
          />
          <Button icon="plus" intent={Intent.PRIMARY} onClick={onNewJob}>
            New Job
          </Button>
        </div>
      </div>
      <Divider />
      <AiJobList
        jobs={jobs}
        onSelect={onSelect}
        selectedJobId={selectedJobId}
      />
    </Card>
  );
}
