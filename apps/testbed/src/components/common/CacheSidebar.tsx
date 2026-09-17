import { Button, Card, Classes, Divider } from '@blueprintjs/core';

import { EmptyState } from './EmptyState';

interface CacheSidebarProps {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  refreshing: boolean;
  onRefresh: () => void;
}

export function CacheSidebar({
  title,
  emptyTitle,
  emptyDescription,
  refreshing,
  onRefresh,
}: CacheSidebarProps) {
  return (
    <Card className="cache-sidebar" compact elevation={1}>
      <div className="panel-heading">
        <div>
          <h1 className={Classes.HEADING}>{title}</h1>
          <span className={Classes.TEXT_MUTED}>Requests / Entries</span>
        </div>
        <Button
          aria-label={`Refresh ${title} entries`}
          disabled={refreshing}
          icon="refresh"
          loading={refreshing}
          onClick={onRefresh}
          size="small"
          title={`Refresh ${title} entries`}
          variant="minimal"
        />
      </div>
      <Divider />
      <div className="sidebar-content">
        <EmptyState
          description={emptyDescription}
          icon="database"
          title={emptyTitle}
        />
      </div>
    </Card>
  );
}
