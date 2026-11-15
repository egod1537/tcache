import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiRequestError,
  cancelAiJob,
  createAiJob,
  getAiJob,
  getAiJobResult,
  listAiJobs,
  type AiJobResult,
  type AiJobView,
} from '../../apps/testbed/src/api/client';
import type { TcacheStatusState } from '../../apps/testbed/src/api/useTcacheStatus';
import { Workspace } from '../../apps/testbed/src/components/layout/Workspace';
import { AiDetail } from './AiDetail';
import { AiSidebar } from './AiSidebar';
import { NewAiJobDialog } from './components/NewAiJobDialog';
import { useAiJobStream } from './useAiJobStream';

const SELECTED_JOB_KEY = 'tcache.ai.selectedJobId';

interface AiCachePageProps {
  dark: boolean;
  status: TcacheStatusState;
}

function upsertJob(jobs: AiJobView[], job: AiJobView) {
  return [
    job,
    ...jobs.filter((candidate) => candidate.jobId !== job.jobId),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function AiCachePage({ dark, status }: AiCachePageProps) {
  const [jobs, setJobs] = useState<AiJobView[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() =>
    window.localStorage.getItem(SELECTED_JOB_KEY),
  );
  const [result, setResult] = useState<AiJobResult | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancellingJobIds, setCancellingJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [reconnectRevision, setReconnectRevision] = useState(0);
  const resultRequestIdRef = useRef(0);
  const selectedJobIdRef = useRef(selectedJobId);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  function selectJob(jobId: string | null) {
    selectedJobIdRef.current = jobId;
    resultRequestIdRef.current += 1;
    setSelectedJobId(jobId);
    setResult(null);
    setResultLoading(false);
    setCancelError(null);
    setInspectionError(null);
    if (jobId) window.localStorage.setItem(SELECTED_JOB_KEY, jobId);
    else window.localStorage.removeItem(SELECTED_JOB_KEY);
  }

  const stream = useAiJobStream(
    selectedJob?.jobId ?? null,
    (job) => setJobs((current) => upsertJob(current, job)),
    reconnectRevision,
  );

  async function loadResult(jobId: string) {
    const requestId = ++resultRequestIdRef.current;
    setResultLoading(true);
    try {
      const loaded = await getAiJobResult(jobId);
      if (resultRequestIdRef.current === requestId) setResult(loaded);
    } catch {
      if (resultRequestIdRef.current === requestId) setResult(null);
    } finally {
      if (resultRequestIdRef.current === requestId) setResultLoading(false);
    }
  }

  async function refreshJobs() {
    setRefreshing(true);
    setRefreshError(false);
    try {
      let nextJobs = await listAiJobs();
      const storedId =
        selectedJobId ?? window.localStorage.getItem(SELECTED_JOB_KEY);
      if (storedId && !nextJobs.some((job) => job.jobId === storedId)) {
        const restored = await getAiJob(storedId).catch(() => null);
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
    if (!selectedJob) return;
    if (['completed', 'failed', 'cancelled'].includes(selectedJob.status)) {
      void loadResult(selectedJob.jobId);
    }
  }, [selectedJob?.jobId, selectedJob?.status]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function reconcile() {
      try {
        const nextJobs = await listAiJobs();
        if (disposed) return;
        setRefreshError(false);
        if (selectedJobId) {
          try {
            const current = await getAiJob(selectedJobId);
            if (disposed) return;
            setJobs(upsertJob(nextJobs, current));
            setInspectionError(null);
          } catch (error) {
            if (disposed) return;
            if (error instanceof ApiRequestError && error.status === 404) {
              setJobs(nextJobs);
              selectJob(null);
              setInspectionError(error.message);
            } else {
              setInspectionError(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        } else {
          setJobs(nextJobs);
        }
      } catch {
        if (!disposed) setRefreshError(true);
      } finally {
        if (!disposed) timer = setTimeout(() => void reconcile(), 3000);
      }
    }
    timer = setTimeout(() => void reconcile(), 3000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [selectedJobId]);

  async function create(request: unknown) {
    setCreating(true);
    try {
      const created = await createAiJob(request);
      const job = await getAiJob(created.jobId);
      setJobs((current) => upsertJob(current, job));
      selectJob(job.jobId);
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  }

  async function cancel(jobId: string) {
    setCancellingJobIds((current) => new Set(current).add(jobId));
    setCancelError(null);
    try {
      await cancelAiJob(jobId);
      const job = await getAiJob(jobId);
      setJobs((current) => upsertJob(current, job));
    } catch (error) {
      if (selectedJobIdRef.current === jobId) {
        setCancelError(
          error instanceof Error ? error.message : 'Failed to cancel AI Job',
        );
      }
    } finally {
      setCancellingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  }

  async function reconnect(jobId: string) {
    try {
      const job = await getAiJob(jobId);
      setJobs((current) => upsertJob(current, job));
    } catch {
      // Reopen SSE even when polling is unavailable.
    }
    if (selectedJobIdRef.current === jobId) {
      setReconnectRevision((current) => current + 1);
    }
  }

  return (
    <>
      <Workspace
        sidebar={
          <AiSidebar
            jobs={jobs}
            onNewJob={() => setDialogOpen(true)}
            onRefresh={() => void refreshJobs()}
            onSelect={selectJob}
            refreshError={refreshError}
            refreshing={refreshing}
            selectedJobId={selectedJobId}
          />
        }
      >
        <>
          {inspectionError && <div role="alert">{inspectionError}</div>}
          <AiDetail
            cancelError={cancelError}
            cancelling={cancellingJobIds.has(selectedJob?.jobId ?? '')}
            job={selectedJob}
            onCancel={(jobId) => void cancel(jobId)}
            onReconnect={(jobId) => void reconnect(jobId)}
            // A slow result response for a previously selected Job must not show.
            result={result?.jobId === selectedJob?.jobId ? result : null}
            resultLoading={resultLoading}
            serverState={status.server}
            service={status.service}
            stream={stream}
            systemState={status.aiCache}
          />
        </>
      </Workspace>
      <NewAiJobDialog
        creating={creating}
        dark={dark}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={create}
      />
    </>
  );
}
