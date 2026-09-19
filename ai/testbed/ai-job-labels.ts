import { Intent } from '@blueprintjs/core';

import type { AiJobStatus } from '../../apps/testbed/src/api/client';
import type { AiConnectionState } from './ai-job-stream';

export function statusIntent(status: AiJobStatus) {
  if (status === 'completed') return Intent.SUCCESS;
  if (status === 'failed') return Intent.DANGER;
  if (status === 'cancelled') return Intent.WARNING;
  return Intent.PRIMARY;
}

export function connectionIntent(state: AiConnectionState) {
  if (state === 'connected') return Intent.SUCCESS;
  if (state === 'disconnected') return Intent.NONE;
  return Intent.WARNING;
}

export function connectionLabel(state: AiConnectionState) {
  return state.toUpperCase();
}
