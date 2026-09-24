import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiRequestError,
  cancelRouteJob,
  createRouteJob,
  getRouteJob,
  getRouteJobResult,
  type NormalizedRouteProviderResult,
  type RoutePlaygroundResponse,
} from '../../../apps/testbed/src/api/client';
import {
  buildRouteRequest,
  buildRouteRequestPreview,
  createDefaultRouteDraft,
  createRoutePresetDraft,
  parseRawRouteRequest,
  ROUTE_PLAYGROUND_PRESETS,
  type PlaygroundError,
  type RouteRequestDraft,
  type ValidationState,
} from './playground-types';

export function useRoutePlayground() {
  const [draft, setDraftState] = useState<RouteRequestDraft>(
    createDefaultRouteDraft,
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    ROUTE_PLAYGROUND_PRESETS[0]!.id,
  );
  const [rawOverride, setRawOverrideState] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>({
    state: 'idle',
    message: '검증하지 않음',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PlaygroundError | null>(null);
  const [response, setResponse] = useState<RoutePlaygroundResponse | null>(
    null,
  );
  const [submittedRequest, setSubmittedRequest] = useState<unknown>(null);
  const [requestTimestamp, setRequestTimestamp] = useState<string | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const generatedRequest = useMemo(() => {
    try {
      return buildRouteRequest(draft);
    } catch {
      return null;
    }
  }, [draft]);
  const rawJson =
    rawOverride ??
    JSON.stringify(
      generatedRequest ?? buildRouteRequestPreview(draft),
      null,
      2,
    );

  useEffect(() => () => controllerRef.current?.abort(), []);

  function setDraft(
    next:
      RouteRequestDraft | ((current: RouteRequestDraft) => RouteRequestDraft),
  ) {
    setDraftState(next);
    setSelectedPresetId('');
    setRawOverrideState(null);
    setValidation({ state: 'idle', message: '검증하지 않음' });
    clearStaleResult();
  }

  function selectPreset(presetId: string) {
    const preset = ROUTE_PLAYGROUND_PRESETS.find(
      (candidate) => candidate.id === presetId,
    );
    if (!preset) return;
    controllerRef.current?.abort();
    setDraftState(createRoutePresetDraft(preset));
    setSelectedPresetId(preset.id);
    setRawOverrideState(null);
    setValidation({ state: 'idle', message: '검증하지 않음' });
    clearStaleResult();
  }

  function setRawOverride(value: string | null) {
    setRawOverrideState(value);
    setValidation({ state: 'idle', message: '검증하지 않음' });
    clearStaleResult();
  }

  function getRequest() {
    const request =
      rawOverride !== null
        ? parseRawRouteRequest(rawOverride)
        : buildRouteRequest(draft);
    return request;
  }

  function clearStaleResult() {
    setError(null);
    setResponse(null);
    setSubmittedRequest(null);
    setRequestTimestamp(null);
    setSelectedRouteIndex(0);
  }

  function validate() {
    try {
      const request = getRequest();
      setValidation({ state: 'valid', message: '유효한 요청입니다.' });
      return request;
    } catch (validationError) {
      setValidation({
        state: 'invalid',
        message:
          validationError instanceof Error
            ? validationError.message
            : '경로 요청이 올바르지 않습니다.',
      });
      return null;
    }
  }

  async function run() {
    const request = validate();
    if (!request) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError(null);
    setResponse(null);
    setSubmittedRequest(request);
    setRequestTimestamp(new Date().toISOString());
    setSelectedRouteIndex(0);

    try {
      setResponse(await executeRouteJob(request, controller.signal));
    } catch (requestError) {
      if (!controller.signal.aborted) setError(toPlaygroundError(requestError));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(false);
      }
    }
  }

  function reset() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setDraftState(createDefaultRouteDraft());
    setSelectedPresetId(ROUTE_PLAYGROUND_PRESETS[0]!.id);
    setRawOverrideState(null);
    setValidation({ state: 'idle', message: '검증하지 않음' });
    setPending(false);
    setError(null);
    setResponse(null);
    setSubmittedRequest(null);
    setRequestTimestamp(null);
    setSelectedRouteIndex(0);
  }

  return {
    draft,
    setDraft,
    rawJson,
    rawOverride,
    setRawOverride,
    validation,
    validate,
    pending,
    error,
    response,
    submittedRequest,
    requestTimestamp,
    selectedRouteIndex,
    setSelectedRouteIndex,
    selectedPresetId,
    selectPreset,
    run,
    reset,
  };
}

async function executeRouteJob(
  request: unknown,
  signal: AbortSignal,
): Promise<RoutePlaygroundResponse> {
  let jobId: string | null = null;
  try {
    const created = await createRouteJob(request, signal);
    jobId = created.jobId;
    let job = await getRouteJob(jobId, signal);
    while (job.status === 'queued' || job.status === 'running') {
      await abortableDelay(100, signal);
      job = await getRouteJob(jobId, signal);
    }

    if (job.status !== 'completed') {
      throw new ApiRequestError(
        job.error?.message ??
          `Route Job이 ${job.status} 상태로 종료되었습니다.`,
        409,
        job.error?.code ?? `ROUTE_JOB_${job.status.toUpperCase()}`,
        job.error?.details,
      );
    }

    const completed = await getRouteJobResult(jobId, signal);
    const result = readNormalizedResult(completed.result);
    if (!job.normalizedRequest) {
      throw new ApiRequestError(
        'Route Job의 정규화 요청이 없습니다.',
        502,
        'INVALID_ROUTE_JOB_RESPONSE',
      );
    }
    return {
      jobId,
      provider: completed.provider ?? result.provider,
      ...(job.selectedProvider
        ? { selectedProvider: job.selectedProvider }
        : {}),
      ...(job.providerSelectionReason
        ? { providerSelectionReason: job.providerSelectionReason }
        : {}),
      ...(job.providerSelectionSource
        ? { providerSelectionSource: job.providerSelectionSource }
        : {}),
      ...(job.providerCapabilities
        ? { providerCapabilities: job.providerCapabilities }
        : {}),
      ...(job.providerAvailable !== undefined
        ? { providerAvailable: job.providerAvailable }
        : {}),
      ...(job.providerUnavailableReason
        ? { providerUnavailableReason: job.providerUnavailableReason }
        : {}),
      ...(job.providerRequest !== undefined
        ? { providerRequest: job.providerRequest }
        : {}),
      ...(job.rawProviderResponse !== undefined
        ? { rawProviderResponse: job.rawProviderResponse }
        : {}),
      ...(job.rawProviderResponseExposed !== undefined
        ? { rawProviderResponseExposed: job.rawProviderResponseExposed }
        : {}),
      normalizedRequest: job.normalizedRequest,
      ...(completed.providerLatencyMs !== undefined
        ? { providerLatencyMs: completed.providerLatencyMs }
        : {}),
      ...(completed.cache ? { cache: completed.cache } : {}),
      result,
    };
  } catch (error) {
    if (signal.aborted && jobId) {
      void cancelRouteJob(jobId).catch(() => undefined);
    }
    throw error;
  }
}

function readNormalizedResult(value: unknown): NormalizedRouteProviderResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { routes?: unknown }).routes) ||
    typeof (value as { provider?: unknown }).provider !== 'string'
  ) {
    throw new ApiRequestError(
      'Route Job 결과 형식이 올바르지 않습니다.',
      502,
      'INVALID_ROUTE_JOB_RESPONSE',
    );
  }
  return value as NormalizedRouteProviderResult;
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function toPlaygroundError(error: unknown): PlaygroundError {
  if (error instanceof ApiRequestError) {
    return {
      httpStatus: error.status,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  return {
    httpStatus: null,
    code: 'REQUEST_ERROR',
    message:
      error instanceof Error ? error.message : '경로 요청에 실패했습니다.',
  };
}
