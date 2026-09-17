import { Card, Classes, Tag } from '@blueprintjs/core';

import type { CheckState } from '../../api/useTcacheStatus';
import { HealthTag } from './HealthTag';

interface ServiceStatusProps {
  name: string;
  description: string;
  state: CheckState;
  endpoint?: string;
}

export function ServiceStatus({
  name,
  description,
  state,
  endpoint,
}: ServiceStatusProps) {
  return (
    <Card className="service-card" compact>
      <div className="service-card-heading">
        <div>
          <h3 className={Classes.HEADING}>{name}</h3>
          <p className={Classes.TEXT_MUTED}>{description}</p>
        </div>
        <HealthTag state={state} />
      </div>
      {endpoint && (
        <Tag className={Classes.MONOSPACE_TEXT} icon="link" minimal>
          {endpoint}
        </Tag>
      )}
    </Card>
  );
}
