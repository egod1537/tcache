import { Classes, Intent, Tag } from '@blueprintjs/core';

import type {
  RouteJobStatus,
  RouteJobView,
} from '../../../apps/testbed/src/api/client';
import { EmptyState } from '../../../apps/testbed/src/components/common/EmptyState';
import { routeJobStatusLabel, routeModeLabel } from '../route-ui-labels';

function statusIntent(status: RouteJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

interface RouteJobListProps {
  jobs: RouteJobView[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}

export function RouteJobList({
  jobs,
  selectedJobId,
  onSelect,
}: RouteJobListProps) {
  if (!jobs.length) {
    return (
      <div className="sidebar-content">
        <EmptyState
          description="요청을 생성하면 작업 처리 과정과 결과를 확인할 수 있습니다."
          icon="route"
          title="경로 작업이 없습니다"
        />
      </div>
    );
  }

  return (
    <div className="route-job-list" role="listbox" aria-label="경로 작업">
      {jobs.map((job) => (
        <button
          aria-selected={selectedJobId === job.jobId}
          className="route-job-list-item"
          key={job.jobId}
          onClick={() => onSelect(job.jobId)}
          role="option"
          type="button"
        >
          <span className="job-list-primary">
            <code className={Classes.MONOSPACE_TEXT}>
              {job.jobId.slice(0, 18)}
            </code>
            <Tag intent={statusIntent(job.status)} minimal>
              {routeJobStatusLabel(job.status)}
            </Tag>
          </span>
          <span className={`${Classes.TEXT_MUTED} job-list-secondary`}>
            {routeModeLabel(job.request.travelMode)} · {job.stage} ·{' '}
            {job.progress}%
          </span>
          <span className={`${Classes.TEXT_MUTED} job-list-secondary`}>
            생성 {new Date(job.createdAt).toLocaleString('ko-KR')}
          </span>
        </button>
      ))}
    </div>
  );
}
