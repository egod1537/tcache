import { Button, FormGroup, HTMLSelect, InputGroup } from '@blueprintjs/core';
import { useState } from 'react';

import type { RouteRequestDraft } from './playground-types';

export function RouteAdvancedOptions({
  draft,
  rawJson,
  rawOverride,
  onChange,
  onRawOverride,
}: {
  draft: RouteRequestDraft;
  rawJson: string;
  rawOverride: string | null;
  onChange: (draft: RouteRequestDraft) => void;
  onRawOverride: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="route-playground-advanced">
      <Button
        alignText="left"
        fill
        icon="settings"
        onClick={() => setOpen((current) => !current)}
        rightIcon={open ? 'chevron-up' : 'chevron-down'}
        size="small"
        variant="minimal"
      >
        Advanced Options
      </Button>
      {open && (
        <div className="route-playground-advanced-fields">
          <FormGroup label="Departure Time" labelFor="playground-departure">
            <InputGroup
              id="playground-departure"
              onChange={(event) =>
                onChange({ ...draft, departureTime: event.target.value })
              }
              type="datetime-local"
              value={draft.departureTime}
            />
          </FormGroup>
          <div className="route-playground-inline-fields">
            <FormGroup label="Language" labelFor="playground-language">
              <InputGroup
                id="playground-language"
                onChange={(event) =>
                  onChange({ ...draft, languageCode: event.target.value })
                }
                placeholder="ja"
                value={draft.languageCode}
              />
            </FormGroup>
            <FormGroup label="Region" labelFor="playground-region">
              <InputGroup
                id="playground-region"
                onChange={(event) =>
                  onChange({ ...draft, regionCode: event.target.value })
                }
                placeholder="JP"
                value={draft.regionCode}
              />
            </FormGroup>
          </div>
          <FormGroup
            label="Routing Preference"
            labelFor="playground-routing-preference"
          >
            <HTMLSelect
              disabled={draft.travelMode !== 'DRIVING'}
              fill
              id="playground-routing-preference"
              onChange={(event) =>
                onChange({ ...draft, routingPreference: event.target.value })
              }
              options={[
                { value: '', label: 'Google default' },
                { value: 'TRAFFIC_AWARE', label: 'Traffic aware' },
                {
                  value: 'TRAFFIC_AWARE_OPTIMAL',
                  label: 'Traffic aware optimal',
                },
                { value: 'TRAFFIC_UNAWARE', label: 'Traffic unaware' },
              ]}
              value={draft.routingPreference}
            />
          </FormGroup>
          <div className="route-playground-raw-heading">
            <strong>Raw Request JSON</strong>
            {rawOverride !== null && (
              <Button
                onClick={() => onRawOverride(null)}
                size="small"
                variant="minimal"
              >
                Reset from form
              </Button>
            )}
          </div>
          <textarea
            aria-label="Raw Route request JSON"
            className="bp6-input route-playground-raw-editor"
            onChange={(event) => onRawOverride(event.target.value)}
            spellCheck={false}
            value={rawJson}
          />
        </div>
      )}
    </section>
  );
}
