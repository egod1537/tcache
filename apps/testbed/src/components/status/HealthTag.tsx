import { Intent, Tag } from '@blueprintjs/core';

import type { CheckState } from '../../api/useTcacheStatus';

interface HealthTagProps {
  state: CheckState;
  label?: string;
}

const STATE_LABELS: Record<CheckState, string> = {
  checking: '확인 중',
  online: '온라인',
  offline: '오프라인',
};

export function HealthTag({ state, label }: HealthTagProps) {
  const intent =
    state === 'online'
      ? Intent.SUCCESS
      : state === 'offline'
        ? Intent.DANGER
        : Intent.NONE;
  const icon =
    state === 'online' ? 'tick-circle' : state === 'offline' ? 'error' : 'time';

  return (
    <Tag icon={icon} intent={intent} minimal>
      {label ? `${label} · ` : ''}
      {STATE_LABELS[state]}
    </Tag>
  );
}
