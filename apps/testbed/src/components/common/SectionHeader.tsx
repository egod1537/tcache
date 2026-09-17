import { Classes } from '@blueprintjs/core';
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="section-heading">
      <div>
        <h2 className={Classes.HEADING}>{title}</h2>
        {description && <p className={Classes.TEXT_MUTED}>{description}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
