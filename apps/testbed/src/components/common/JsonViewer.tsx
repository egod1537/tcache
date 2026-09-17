import { Button, Callout, Classes, Intent } from '@blueprintjs/core';
import { useEffect, useMemo, useState } from 'react';

import { SectionHeader } from './SectionHeader';

interface JsonViewerProps {
  title: string;
  value: unknown;
}

export function JsonViewer({ title, value }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);

  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [json]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="json-viewer" aria-label={title}>
      <SectionHeader
        title={title}
        actions={
          <Button
            icon={copied ? 'tick' : 'clipboard'}
            intent={copied ? Intent.SUCCESS : Intent.NONE}
            onClick={() => void copy()}
            size="small"
            variant="minimal"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        }
      />
      {copyError && (
        <Callout compact intent={Intent.WARNING}>
          Copy failed. Select the JSON and copy it manually.
        </Callout>
      )}
      <pre className={`${Classes.CODE_BLOCK} json-output`}>{json}</pre>
    </section>
  );
}
