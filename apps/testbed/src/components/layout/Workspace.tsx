import type { ReactNode } from 'react';

interface WorkspaceProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function Workspace({ sidebar, children }: WorkspaceProps) {
  return (
    <main className="workspace">
      {sidebar}
      <section className="main-panel">{children}</section>
    </main>
  );
}
