import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiRequestError,
  cancelMatrixJob,
  createMatrixJob,
  getMatrixJob,
  getMatrixResult,
  subscribeMatrixJob,
  type CreateMatrixJobResponse,
  type MatrixJobStreamEventType,
  type MatrixJobView,
  type MatrixRequest,
  type MatrixResult,
  type RouteJobStreamState,
} from '../../../apps/testbed/src/api/client';
import {
  applyMatrixPreset,
  buildMatrixRequest,
  createMatrixDraft,
  MatrixSubmissionGuard,
  shouldUseMatrixPolling,
  type MatrixRequestDraft,
} from './matrix-types';

export interface MatrixTimelineEntry {
  key: string;
  receivedAt: string;
  type: MatrixJobStreamEventType | 'created' | 'poll';
  message: string;
  job: MatrixJobView;
}

export interface MatrixUiError {
  code: string;
  message: string;
  details?: unknown;
}

function terminal(job: MatrixJobView | null) {
  return job
    ? ['completed', 'failed', 'cancelled'].includes(job.status)
    : false;
}

function upsert(jobs: MatrixJobView[], job: MatrixJobView) {
  return [job, ...jobs.filter(({ jobId }) => jobId !== job.jobId)].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
}

export function useMatrixQuery() {
  const [draft, setDraft] = useState<MatrixRequestDraft>(() =>
    createMatrixDraft(),
  );
  const [presetId, setPresetId] = useState('tokyo-3');
  const [jobs, setJobs] = useState<MatrixJobView[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [result, setResult] = useState<MatrixResult | null>(null);
  const [submittedRequest, setSubmittedRequest] =
    useState<MatrixRequest | null>(null);
  const [createResponse, setCreateResponse] =
    useState<CreateMatrixJobResponse | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [resultLoading, setResultLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<MatrixUiError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [streamState, setStreamState] =
    useState<RouteJobStreamState>('disconnected');
  const [progressSource, setProgressSource] = useState<
    'sse' | 'polling' | 'none'
  >('none');
  const [timelines, setTimelines] = useState<
    Record<string, MatrixTimelineEntry[]>
  >({});
  const resultRequestRef = useRef<string | null>(null);
  const submissionGuardRef = useRef(new MatrixSubmissionGuard());

  const selectedJob = useMemo(
    () => jobs.find(({ jobId }) => jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const timeline = selectedJobId ? (timelines[selectedJobId] ?? []) : [];

  function record(
    job: MatrixJobView,
    type: MatrixTimelineEntry['type'],
    message = timelineMessage(job, type),
  ) {
    const entry: MatrixTimelineEntry = {
      key: `${job.updatedAt}:${type}:${job.stats.completedPairs}`,
      receivedAt: new Date().toISOString(),
      type,
      message,
      job,
    };
    setTimelines((current) => {
      const entries = current[job.jobId] ?? [];
      if (entries.some(({ key }) => key === entry.key)) return current;
      return { ...current, [job.jobId]: [...entries, entry] };
    });
  }

  function receiveJob(
    job: MatrixJobView,
    source: 'sse' | 'polling',
    type: MatrixJobStreamEventType | 'poll',
  ) {
    setJobs((current) => upsert(current, job));
    setProgressSource(source);
    if (job.error) setError(job.error);
    record(job, type);
  }

  useEffect(() => {
    if (!selectedJob || terminal(selectedJob)) {
      setStreamState('disconnected');
      return;
    }
    setStreamState('reconnecting');
    return subscribeMatrixJob(
      selectedJob.jobId,
      (job, type) => receiveJob(job, 'sse', type),
      setStreamState,
    );
  }, [selectedJob?.jobId, selectedJob?.status]);

  useEffect(() => {
    const selectedJobId = selectedJob?.jobId;
    if (!selectedJobId || !shouldUseMatrixPolling(selectedJob, streamState)) {
      return;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const job = await getMatrixJob(selectedJobId);
        if (!stopped) receiveJob(job, 'polling', 'poll');
      } catch (pollError) {
        if (!stopped) setError(toUiError(pollError));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [selectedJob?.jobId, selectedJob?.status, streamState]);

  useEffect(() => {
    if (selectedJob?.status !== 'completed') return;
    if (resultRequestRef.current === selectedJob.jobId) return;
    resultRequestRef.current = selectedJob.jobId;
    setResultLoading(true);
    void getMatrixResult(selectedJob.jobId)
      .then((value) => {
        if (selectedJobId === value.jobId) setResult(value);
      })
      .catch((resultError) => setError(toUiError(resultError)))
      .finally(() => setResultLoading(false));
  }, [selectedJob?.jobId, selectedJob?.status, selectedJobId]);

  function selectPreset(id: string) {
    setPresetId(id);
    setDraft((current) => applyMatrixPreset(current, id));
    setValidationError(null);
  }

  async function run() {
    if (!submissionGuardRef.current.tryStart()) return;
    let request: MatrixRequest;
    try {
      request = buildMatrixRequest(draft);
      setValidationError(null);
    } catch (validation) {
      setValidationError(
        validation instanceof Error
          ? validation.message
          : '요청이 올바르지 않습니다.',
      );
      submissionGuardRef.current.finish();
      return;
    }
    setRequestPending(true);
    setError(null);
    setResult(null);
    setCreateResponse(null);
    setSubmittedRequest(request);
    resultRequestRef.current = null;
    try {
      const created = await createMatrixJob(request);
      setCreateResponse(created);
      setSelectedJobId(created.jobId);
      const job = await getMatrixJob(created.jobId);
      setJobs((current) => upsert(current, job));
      record(job, 'created', 'Matrix job created');
    } catch (requestError) {
      setError(toUiError(requestError));
    } finally {
      setRequestPending(false);
      submissionGuardRef.current.finish();
    }
  }

  async function cancel() {
    if (!selectedJob || terminal(selectedJob) || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelMatrixJob(selectedJob.jobId);
      const job = await getMatrixJob(selectedJob.jobId);
      receiveJob(job, 'polling', 'poll');
    } catch (cancelError) {
      setError(toUiError(cancelError));
    } finally {
      setCancelling(false);
    }
  }

  async function selectJob(jobId: string) {
    const existing = jobs.find((job) => job.jobId === jobId);
    setSelectedJobId(jobId);
    setResult(null);
    setError(existing?.error ?? null);
    setCreateResponse(null);
    setSubmittedRequest(existing?.request ?? null);
    setStreamState('disconnected');
    setProgressSource('none');
    resultRequestRef.current = null;
    try {
      const job = await getMatrixJob(jobId);
      setJobs((current) => upsert(current, job));
    } catch (selectError) {
      setError(toUiError(selectError));
    } finally {
      setResultLoading(false);
    }
  }

  return {
    draft,
    setDraft,
    presetId,
    selectPreset,
    jobs,
    selectedJob,
    result,
    submittedRequest,
    createResponse,
    requestPending,
    resultLoading,
    cancelling,
    error,
    validationError,
    streamState,
    progressSource,
    timeline,
    run,
    cancel,
    selectJob,
  };
}

function timelineMessage(
  job: MatrixJobView,
  type: MatrixTimelineEntry['type'],
) {
  if (type === 'completed') return 'Matrix assembled and completed';
  if (type === 'failed') return job.error?.message ?? 'Matrix job failed';
  if (type === 'cancelled') return 'Matrix job cancelled';
  if (job.stage === 'building_pairs') {
    return `Built ${job.stats.totalPairs} directed pairs`;
  }
  if (job.stage === 'resolving_routes') {
    return `Resolved ${job.stats.completedPairs} / ${job.stats.totalPairs} pairs · cache ${job.stats.cacheHits} / provider ${job.stats.providerCalls}`;
  }
  return `${job.stage} · ${job.message}`;
}

function toUiError(error: unknown): MatrixUiError {
  if (error instanceof ApiRequestError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  return {
    code: 'CLIENT_ERROR',
    message: error instanceof Error ? error.message : '알 수 없는 client 오류',
  };
}
