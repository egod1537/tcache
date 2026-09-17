import { Classes, Tag } from '@blueprintjs/core';

interface CommitInfoProps {
  version: string | undefined;
}

export function CommitInfo({ version }: CommitInfoProps) {
  const value = version && version !== 'dev' ? version : 'dev';
  const short = value.length > 9 ? value.slice(0, 7) : value;

  return (
    <Tag
      aria-label={`Commit ${value}`}
      className={`${Classes.MONOSPACE_TEXT} navbar-commit`}
      icon="git-commit"
      minimal
      title={`Commit ${value}`}
    >
      {short}
    </Tag>
  );
}
