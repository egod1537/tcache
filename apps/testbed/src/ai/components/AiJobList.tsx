import { Classes, Intent, Tag } from '@blueprintjs/core';

import type { AiJobStatus, AiJobView } from '../../api/client';
import { EmptyState } from '../../components/common/EmptyState';

function statusIntent(status: AiJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

interface AiJobListProps {
  jobs: AiJobView[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}

export function AiJobList({ jobs, selectedJobId, onSelect }: AiJobListProps) {
  if (!jobs.length) {
    return (
      <div className="sidebar-content">
        <EmptyState
          description="Create an AI Job to inspect live progress and results."
          icon="predictive-analysis"
          title="No AI Jobs yet"
        />
      </div>
    );
  }
  return (
    <div className="route-job-list" role="listbox" aria-label="AI Jobs">
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
            {job.provider} · {job.model}
          </span>
          <span className={`${Classes.TEXT_MUTED} job-list-secondary`}>
            {job.stage} · {job.progress}%
          </span>
        </button>
      ))}
    </div>
  );
}
