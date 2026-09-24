import { Card, Classes, Tag } from '@blueprintjs/core';

import type { TcacheStatusState } from '../../../apps/testbed/src/api/useTcacheStatus';
import { HealthTag } from '../../../apps/testbed/src/components/status/HealthTag';
import { MatrixHistory } from './MatrixHistory';
import { MatrixJobDetail } from './MatrixJobDetail';
import { MatrixRequestPanel } from './MatrixRequestPanel';
import { useMatrixQuery } from './useMatrixQuery';

export function MatrixQueryPage({ status }: { status: TcacheStatusState }) {
  const matrix = useMatrixQuery();
  const redisState =
    status.service?.redis === 'ok'
      ? 'online'
      : status.service?.redis === 'error'
        ? 'offline'
        : 'checking';
  const providerLabel = matrix.selectedJob
    ? matrix.selectedJob.stats.providerCalls > 0
      ? `Used (${matrix.selectedJob.stats.providerCalls} calls)`
      : matrix.selectedJob.stats.cacheHits > 0
        ? 'Not called (cache hit)'
        : 'Not called yet'
    : 'Not probed';

  return (
    <main className="route-tool-workspace matrix-query-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>Matrix Query</h1>
          <p className={Classes.TEXT_MUTED}>
            tcache가 directed TravelTimeMatrix를 생성하는 Job·cache·provider
            흐름을 검증합니다.
          </p>
        </div>
      </div>

      <Card className="matrix-health-strip" compact>
        <span>
          tcache <HealthTag state={status.server} />
        </span>
        <span>
          route API <HealthTag state={status.routeCache} />
        </span>
        <span>
          cache storage <HealthTag state={redisState} />
        </span>
        <span>
          provider <Tag minimal>{providerLabel}</Tag>
        </span>
      </Card>

      <div className="matrix-query-grid">
        <MatrixRequestPanel
          draft={matrix.draft}
          onChange={matrix.setDraft}
          onPreset={matrix.selectPreset}
          onRun={() => void matrix.run()}
          pending={matrix.requestPending}
          presetId={matrix.presetId}
          validationError={matrix.validationError}
        />
        <MatrixJobDetail
          cancelling={matrix.cancelling}
          createResponse={matrix.createResponse}
          error={matrix.error}
          job={matrix.selectedJob}
          onCancel={() => void matrix.cancel()}
          progressSource={matrix.progressSource}
          result={matrix.result}
          resultLoading={matrix.resultLoading}
          streamState={matrix.streamState}
          submittedRequest={matrix.submittedRequest}
          timeline={matrix.timeline}
        />
      </div>

      <MatrixHistory
        jobs={matrix.jobs}
        onSelect={(jobId) => void matrix.selectJob(jobId)}
        selectedJobId={matrix.selectedJob?.jobId ?? null}
      />
    </main>
  );
}
