import { Button, NonIdealState, type IconName } from '@blueprintjs/core';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = 'database',
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const action =
    actionLabel && onAction ? (
      <Button icon="refresh" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : undefined;

  return (
    <NonIdealState
      description={description}
      icon={icon}
      title={title}
      {...(action ? { action } : {})}
    />
  );
}
