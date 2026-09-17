import { useEffect, useMemo, useState } from 'react';

import {
  cancelRouteJob,
  createRouteJob,
  getRouteJob,
  getRouteJobResult,
  listRouteJobs,
  subscribeRouteJob,
  type RouteJobResult,
  type RouteJobStreamEventType,
  type RouteJobStreamState,
  type RouteJobView,
} from '../../apps/testbed/src/api/client';
import type { TcacheStatusState } from '../../apps/testbed/src/api/useTcacheStatus';
import { Workspace } from '../../apps/testbed/src/components/layout/Workspace';
import { NewRouteJobDialog } from './components/NewRouteJobDialog';
import { RouteDetail } from './RouteDetail';
import { RouteSidebar } from './RouteSidebar';

const SELECTED_JOB_KEY = 'tcache.route.selectedJobId';

interface RouteCachePageProps {
  dark: boolean;
  status: TcacheStatusState;
  requestedJobId?: string | null;
  requestedJobSequence?: number;
}

function upsertJob(jobs: RouteJobView[], job: RouteJobView) {
  const next = [
    job,
    ...jobs.filter((candidate) => candidate.jobId !== job.jobId),
  ];
  return next.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function RouteCachePage({
  dark,
  status,
  requestedJobId,
  requestedJobSequence,
}: RouteCachePageProps) {
  const [jobs, setJobs] = useState<RouteJobView[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() =>
    window.localStorage.getItem(SELECTED_JOB_KEY),
  );
  const [result, setResult] = useState<RouteJobResult | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  const [streamState, setStreamState] =
    useState<RouteJobStreamState>('disconnected');
  const [progressSource, setProgressSource] = useState<
    'sse' | 'polling' | 'none'
  >('none');
  const [latestEvent, setLatestEvent] = useState<{
    type: RouteJobStreamEventType | 'poll';
    receivedAt: string;
  } | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  function selectJob(jobId: string) {
    if (jobId === selectedJobId) return;
    setSelectedJobId(jobId);
    setResult(null);
    setStreamState('disconnected');
    setProgressSource('none');
    setLatestEvent(null);
    window.localStorage.setItem(SELECTED_JOB_KEY, jobId);
  }

  async function loadResult(jobId: string) {
    setResultLoading(true);
    try {
      setResult(await getRouteJobResult(jobId));
    } catch {
      setResult(null);
    } finally {
      setResultLoading(false);
    }
  }

  async function refreshJobs() {
    setRefreshing(true);
    setRefreshError(false);
    try {
      let nextJobs = await listRouteJobs();
      const storedId =
        selectedJobId ?? window.localStorage.getItem(SELECTED_JOB_KEY);
      if (storedId && !nextJobs.some((job) => job.jobId === storedId)) {
        const restored = await getRouteJob(storedId).catch(() => null);
        if (restored) nextJobs = upsertJob(nextJobs, restored);
      }
      setJobs(nextJobs);
      if (!storedId && nextJobs[0]) selectJob(nextJobs[0].jobId);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshJobs();
  }, []);

  useEffect(() => {
    if (!requestedJobId) return;
    const existing = jobs.find((job) => job.jobId === requestedJobId);
    if (existing) {
      selectJob(requestedJobId);
      return;
    }
    void getRouteJob(requestedJobId)
      .then((job) => {
        setJobs((current) => upsertJob(current, job));
        selectJob(job.jobId);
      })
      .catch(() => undefined);
  }, [requestedJobId, requestedJobSequence]);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status === 'completed') void loadResult(selectedJob.jobId);
    if (selectedJob.status === 'failed' || selectedJob.status === 'cancelled') {
      void loadResult(selectedJob.jobId);
    }
  }, [selectedJob?.jobId, selectedJob?.status]);

  useEffect(() => {
    if (!selectedJob) {
      setStreamState('disconnected');
      return;
    }

    setStreamState('reconnecting');
    return subscribeRouteJob(
      selectedJob.jobId,
      (job, eventType) => {
        setProgressSource('sse');
        setLatestEvent({
          type: eventType,
          receivedAt: new Date().toISOString(),
        });
        setJobs((current) => upsertJob(current, job));
      },
      (state) => {
        setStreamState(state);
        if (state === 'connected') setProgressSource('sse');
      },
    );
  }, [selectedJob?.jobId]);

  useEffect(() => {
    if (
      !selectedJob ||
      ['completed', 'failed', 'cancelled'].includes(selectedJob.status) ||
      streamState === 'connected'
    ) {
      return;
    }

    let active = true;
    let polling = false;
    setProgressSource('polling');

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const job = await getRouteJob(selectedJob.jobId);
        if (!active) return;
        setJobs((current) => upsertJob(current, job));
        setLatestEvent({ type: 'poll', receivedAt: new Date().toISOString() });
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          setStreamState('disconnected');
        }
      } catch {
        if (active) setStreamState('disconnected');
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedJob?.jobId, selectedJob?.status, streamState]);

  async function create(request: unknown) {
    setCreating(true);
    try {
      const created = await createRouteJob(request);
      const job = await getRouteJob(created.jobId);
      setJobs((current) => upsertJob(current, job));
      selectJob(job.jobId);
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  }

  async function cancel(jobId: string) {
    setCancelling(true);
    try {
      await cancelRouteJob(jobId);
      const job = await getRouteJob(jobId);
      setJobs((current) => upsertJob(current, job));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <Workspace
        sidebar={
          <RouteSidebar
            jobs={jobs}
            onNewRequest={() => setDialogOpen(true)}
            onRefresh={() => void refreshJobs()}
            onSelect={selectJob}
            refreshError={refreshError}
            refreshing={refreshing}
            selectedJobId={selectedJobId}
          />
        }
      >
        <RouteDetail
          cancelling={cancelling}
          job={selectedJob}
          onCancel={(jobId) => void cancel(jobId)}
          result={result}
          resultLoading={resultLoading}
          serverState={status.server}
          service={status.service}
          latestEvent={latestEvent}
          progressSource={progressSource}
          streamState={streamState}
          systemState={status.routeCache}
        />
      </Workspace>
      <NewRouteJobDialog
        creating={creating}
        dark={dark}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={create}
        submitLabel="요청 전송"
        title="새 경로 요청"
      />
    </>
  );
}
