import { useEffect, useReducer, useRef } from 'react';

import {
  subscribeAiJob,
  type AiJobView,
} from '../../apps/testbed/src/api/client';
import {
  aiStreamReducer,
  createAiStreamState,
  type AiStreamState,
} from './ai-job-stream';

/**
 * Opens one EventSource for the selected Job and records what it receives.
 * The subscription is keyed only by `jobId` (status changes must not reconnect)
 * and is closed on Job change and on unmount.
 */
export function useAiJobStream(
  jobId: string | null,
  onJob: (job: AiJobView) => void,
): AiStreamState {
  const [state, dispatch] = useReducer(
    aiStreamReducer,
    jobId,
    createAiStreamState,
  );
  const onJobRef = useRef(onJob);
  onJobRef.current = onJob;

  useEffect(() => {
    dispatch({ type: 'select', jobId });
    if (!jobId) return;
    return subscribeAiJob(
      jobId,
      (job, eventType, payload) => {
        dispatch({
          type: 'event',
          jobId,
          eventType,
          payload,
          receivedAt: new Date().toISOString(),
        });
        onJobRef.current(job);
      },
      (connection) =>
        dispatch({
          type: 'connection',
          jobId,
          state: connection,
          receivedAt: new Date().toISOString(),
        }),
    );
  }, [jobId]);

  // The effect runs after render, so hide state that still belongs to the
  // previously selected Job instead of flashing it for one frame.
  return state.jobId === jobId ? state : createAiStreamState(jobId);
}
