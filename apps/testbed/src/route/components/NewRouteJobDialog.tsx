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
    origin: { latitude: 37.5665, longitude: 126.978 },
    destination: { latitude: 35.1796, longitude: 129.0756 },
    waypoints: [],
    travelMode: 'TRANSIT',
    departureTime: new Date(Date.now() + 3_600_000).toISOString(),
    options: { languageCode: 'ko', units: 'METRIC' },
  },
  null,
  2,
);

interface NewRouteJobDialogProps {
  dark: boolean;
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (request: unknown) => Promise<void>;
}

export function NewRouteJobDialog({
  dark,
  isOpen,
  creating,
  onClose,
  onCreate,
}: NewRouteJobDialogProps) {
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
      icon="route"
      isCloseButtonShown={!creating}
      isOpen={isOpen}
      onClose={onClose}
      title="New Route Job"
      {...(dark ? { portalClassName: Classes.DARK } : {})}
    >
      <DialogBody>
        <p className={Classes.TEXT_MUTED}>
          Submit a route request. The server returns immediately and processes
          it as a background Job.
        </p>
        <textarea
          aria-label="Route Job request JSON"
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
