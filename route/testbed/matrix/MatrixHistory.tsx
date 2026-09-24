import { Card, Classes, Intent, Tag } from '@blueprintjs/core';

import type { MatrixJobView } from '../../../apps/testbed/src/api/client';
import { SectionHeader } from '../../../apps/testbed/src/components/common/SectionHeader';
import { routeJobStatusLabel, routeModeLabel } from '../route-ui-labels';

export function MatrixHistory({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: MatrixJobView[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}) {
  return (
    <Card className="matrix-history" compact>
      <SectionHeader
        title="Session Job History"
        description="현재 browser session에서 생성한 Matrix Job"
      />
      {!jobs.length ? (
        <p className={Classes.TEXT_MUTED}>생성한 Matrix Job이 없습니다.</p>
      ) : (
        <div className="matrix-history-list">
          {jobs.map((job) => (
            <button
              aria-pressed={selectedJobId === job.jobId}
              key={job.jobId}
              onClick={() => onSelect(job.jobId)}
              type="button"
            >
              <span>
                <Tag intent={Intent.PRIMARY} minimal>
                  Matrix
                </Tag>
                <code>{job.jobId.slice(0, 22)}</code>
              </span>
              <span>
                {routeJobStatusLabel(job.status)} ·{' '}
                {job.request.locations.length} locations ·{' '}
                {routeModeLabel(job.request.mode)}
              </span>
              <time>{new Date(job.createdAt).toLocaleTimeString('ko-KR')}</time>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
