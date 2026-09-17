import { useEffect, useMemo, useState } from 'react';

import {
  cancelAiJob,
  createAiJob,
  getAiJob,
  getAiJobResult,
  listAiJobs,
  subscribeAiJob,
  type AiJobResult,
  type AiJobView,
} from '../../apps/testbed/src/api/client';
import type { TcacheStatusState } from '../../apps/testbed/src/api/useTcacheStatus';
import { Workspace } from '../../apps/testbed/src/components/layout/Workspace';
import { AiDetail } from './AiDetail';
import { AiSidebar } from './AiSidebar';
import { NewAiJobDialog } from './components/NewAiJobDialog';

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
  const [streamError, setStreamError] = useState(false);
  const [resultLoading, setResultLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setResult(null);
    setStreamError(false);
    window.localStorage.setItem(SELECTED_JOB_KEY, jobId);
  }

  async function loadResult(jobId: string) {
    setResultLoading(true);
    try {
      setResult(await getAiJobResult(jobId));
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
    if (
      !selectedJob ||
      ['completed', 'failed', 'cancelled'].includes(selectedJob.status)
    ) {
      return;
    }
    return subscribeAiJob(
      selectedJob.jobId,
      (job) => {
        setStreamError(false);
        setJobs((current) => upsertJob(current, job));
      },
      () => setStreamError(true),
    );
  }, [selectedJob?.jobId, selectedJob?.status]);

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
    setCancelling(true);
    try {
      await cancelAiJob(jobId);
      const job = await getAiJob(jobId);
      setJobs((current) => upsertJob(current, job));
    } finally {
      setCancelling(false);
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
        <AiDetail
          cancelling={cancelling}
          job={selectedJob}
          onCancel={(jobId) => void cancel(jobId)}
          result={result}
          resultLoading={resultLoading}
          serverState={status.server}
          service={status.service}
          streamError={streamError}
          systemState={status.aiCache}
        />
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
