import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  Intent,
} from '@blueprintjs/core';
import { useState } from 'react';

const SAMPLE_REQUEST = JSON.stringify(
  {
    provider: import.meta.env.DEV ? 'mock' : 'gemini',
    model: import.meta.env.DEV ? 'mock-ai-v1' : 'gemini-2.5-flash',
    systemPrompt: 'You are a concise assistant.',
    promptVersion: 'v1',
    messages: [{ role: 'user', content: 'Summarize the cache status.' }],
    options: { temperature: 0.2 },
    cache: { enabled: true },
  },
  null,
  2,
);

interface NewAiJobDialogProps {
  dark: boolean;
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (request: unknown) => Promise<void>;
}

export function NewAiJobDialog({
  dark,
  isOpen,
  creating,
  onClose,
  onCreate,
}: NewAiJobDialogProps) {
  const [value, setValue] = useState(SAMPLE_REQUEST);
  const [error, setError] = useState('');

  async function submit() {
    let request: unknown;
    try {
      request = JSON.parse(value);
    } catch {
      setError('Request must be valid JSON.');
      return;
    }
    setError('');
    try {
      await onCreate(request);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to create job',
      );
    }
  }

  return (
    <Dialog
      canEscapeKeyClose={!creating}
      className="new-route-job-dialog"
      icon="predictive-analysis"
      isCloseButtonShown={!creating}
      isOpen={isOpen}
      onClose={onClose}
      title="New AI Job"
      {...(dark ? { portalClassName: Classes.DARK } : {})}
    >
      <DialogBody>
        <p className={Classes.TEXT_MUTED}>
          Submit an AI request. Raw prompts are sent to the server but omitted
          from Job status and SSE payloads.
        </p>
        <textarea
          aria-label="AI Job request JSON"
          className={`${Classes.INPUT} route-request-editor`}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          value={value}
        />
        {error && (
          <Callout compact intent={Intent.DANGER} role="alert">
            {error}
          </Callout>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button disabled={creating} onClick={onClose}>
              Cancel
            </Button>
            <Button
              icon="play"
              intent={Intent.PRIMARY}
              loading={creating}
              onClick={() => void submit()}
            >
              Create Job
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
