import { Classes, Intent, Tag } from '@blueprintjs/core';

import type {
  RouteJobStatus,
  RouteJobView,
} from '../../../apps/testbed/src/api/client';
import { EmptyState } from '../../../apps/testbed/src/components/common/EmptyState';

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
          description="Create a request to inspect the Job lifecycle and result."
          icon="route"
          title="No Route Jobs yet"
        />
      </div>
    );
  }

  return (
    <div className="route-job-list" role="listbox" aria-label="Route Jobs">
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
              {job.status}
            </Tag>
          </span>
          <span className={`${Classes.TEXT_MUTED} job-list-secondary`}>
            {job.request.travelMode} · {job.stage} · {job.progress}%
          </span>
          <span className={`${Classes.TEXT_MUTED} job-list-secondary`}>
            Created {new Date(job.createdAt).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}
