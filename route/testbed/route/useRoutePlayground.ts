import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiRequestError,
  computeGoogleRoute,
  type GoogleProviderComputeResponse,
} from '../../../apps/testbed/src/api/client';
import {
  buildRouteRequest,
  buildRouteRequestPreview,
  createDefaultRouteDraft,
  parseRawRouteRequest,
  type PlaygroundError,
  type RouteRequestDraft,
  type ValidationState,
} from './playground-types';

export function useRoutePlayground() {
  const [draft, setDraftState] = useState<RouteRequestDraft>(
    createDefaultRouteDraft,
  );
  const [rawOverride, setRawOverrideState] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>({
    state: 'idle',
    message: '검증하지 않음',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PlaygroundError | null>(null);
  const [response, setResponse] =
    useState<GoogleProviderComputeResponse | null>(null);
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
      setResponse(await computeGoogleRoute(request, controller.signal));
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
    run,
    reset,
  };
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
