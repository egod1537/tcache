import { Button, FormGroup, HTMLSelect, InputGroup } from '@blueprintjs/core';
import { useState } from 'react';

import type { RouteRequestDraft } from './playground-types';

export function RouteAdvancedOptions({
  draft,
  rawJson,
  rawOverride,
  onChange,
  onRawOverride,
  disabled = false,
}: {
  draft: RouteRequestDraft;
  rawJson: string;
  rawOverride: string | null;
  onChange: (draft: RouteRequestDraft) => void;
  onRawOverride: (value: string | null) => void;
  disabled?: boolean;
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
        고급 옵션
      </Button>
      {open && (
        <div className="route-playground-advanced-fields">
          <div className="route-playground-inline-fields">
            <FormGroup label="국가 코드" labelFor="playground-country">
              <InputGroup
                disabled={disabled}
                id="playground-country"
                maxLength={2}
                onChange={(event) =>
                  onChange({ ...draft, countryCode: event.target.value })
                }
                placeholder="JP"
                value={draft.countryCode}
              />
            </FormGroup>
            <FormGroup label="Provider override" labelFor="playground-provider">
              <HTMLSelect
                disabled={disabled}
                fill
                id="playground-provider"
                onChange={(event) =>
                  onChange({ ...draft, provider: event.target.value })
                }
                options={[
                  { value: '', label: '자동 선택' },
                  { value: 'google', label: 'Google' },
                  { value: 'kakao-mobility', label: 'Kakao Mobility' },
                  { value: 'kakao-maps', label: 'Kakao Maps' },
                  { value: 'ekispert', label: 'Ekispert' },
                  { value: 'navitime', label: 'NAVITIME' },
                  { value: 'otp', label: 'OpenTripPlanner (experimental)' },
                  { value: 'mock', label: 'Mock' },
                ]}
                value={draft.provider}
              />
            </FormGroup>
          </div>
          <FormGroup label="출발 시각" labelFor="playground-departure">
            <InputGroup
              disabled={disabled}
              id="playground-departure"
              onChange={(event) =>
                onChange({ ...draft, departureTime: event.target.value })
              }
              type="datetime-local"
              value={draft.departureTime}
            />
          </FormGroup>
          <div className="route-playground-inline-fields">
            <FormGroup label="언어 코드" labelFor="playground-language">
              <InputGroup
                disabled={disabled}
                id="playground-language"
                onChange={(event) =>
                  onChange({ ...draft, languageCode: event.target.value })
                }
                placeholder="ja"
                value={draft.languageCode}
              />
            </FormGroup>
            <FormGroup label="지역 코드" labelFor="playground-region">
              <InputGroup
                disabled={disabled}
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
            label="경로 탐색 옵션"
            labelFor="playground-routing-preference"
          >
            <HTMLSelect
              disabled={disabled || draft.travelMode !== 'DRIVING'}
              fill
              id="playground-routing-preference"
              onChange={(event) =>
                onChange({ ...draft, routingPreference: event.target.value })
              }
              options={[
                { value: '', label: 'Google 기본값' },
                { value: 'TRAFFIC_AWARE', label: '교통 상황 반영' },
                {
                  value: 'TRAFFIC_AWARE_OPTIMAL',
                  label: '교통 상황 최적 반영',
                },
                { value: 'TRAFFIC_UNAWARE', label: '교통 상황 미반영' },
              ]}
              value={draft.routingPreference}
            />
          </FormGroup>
          <div className="route-playground-raw-heading">
            <strong>원본 요청 JSON</strong>
            {rawOverride !== null && (
              <Button
                disabled={disabled}
                onClick={() => onRawOverride(null)}
                size="small"
                variant="minimal"
              >
                폼 내용으로 되돌리기
              </Button>
            )}
          </div>
          <textarea
            aria-label="원본 경로 요청 JSON"
            className="bp6-input route-playground-raw-editor"
            disabled={disabled}
            onChange={(event) => onRawOverride(event.target.value)}
            spellCheck={false}
            value={rawJson}
          />
        </div>
      )}
    </section>
  );
}
