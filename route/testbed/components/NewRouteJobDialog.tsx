import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  Switch,
} from '@blueprintjs/core';
import { useMemo, useState } from 'react';

import type {
  RouteLocation,
  RouteRequest,
  RouteTravelMode,
} from '../../../apps/testbed/src/api/client';

type LocationKind = RouteLocation['type'];

interface LocationDraft {
  type: LocationKind;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string;
}

const newLocation = (address = ''): LocationDraft => ({
  type: 'address',
  address,
  latitude: '',
  longitude: '',
  placeId: '',
});

const modeOptions: Array<{ value: RouteTravelMode; label: string }> = [
  { value: 'DRIVING', label: 'Driving' },
  { value: 'WALKING', label: 'Walking' },
  { value: 'BICYCLING', label: 'Bicycling' },
  { value: 'TRANSIT', label: 'Transit' },
];

interface NewRouteJobDialogProps {
  dark: boolean;
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (request: unknown) => Promise<void>;
  title?: string;
  description?: string;
  submitLabel?: string;
}

export function NewRouteJobDialog({
  dark,
  isOpen,
  creating,
  onClose,
  onCreate,
  title = 'New Route Job',
  description = 'The backend runs this request through the existing Job, SSE, and cache pipeline.',
  submitLabel = 'Create Job',
}: NewRouteJobDialogProps) {
  const [origin, setOrigin] = useState(() => newLocation('東京駅、日本'));
  const [destination, setDestination] = useState(() =>
    newLocation('東京タワー、日本'),
  );
  const [intermediates, setIntermediates] = useState<LocationDraft[]>([]);
  const [travelMode, setTravelMode] = useState<RouteTravelMode>('DRIVING');
  const [alternatives, setAlternatives] = useState(false);
  const [languageCode, setLanguageCode] = useState('ja');
  const [regionCode, setRegionCode] = useState('JP');
  const [departureTime, setDepartureTime] = useState('');
  const [routingPreference, setRoutingPreference] = useState('');
  const [rawOverride, setRawOverride] = useState<string | null>(null);
  const [error, setError] = useState('');

  const generatedRequest = useMemo(() => {
    try {
      return buildRequest({
        origin,
        destination,
        intermediates,
        travelMode,
        alternatives,
        languageCode,
        regionCode,
        departureTime,
        routingPreference,
      });
    } catch {
      return null;
    }
  }, [
    origin,
    destination,
    intermediates,
    travelMode,
    alternatives,
    languageCode,
    regionCode,
    departureTime,
    routingPreference,
  ]);
  const generatedJson = JSON.stringify(generatedRequest ?? {}, null, 2);

  function updateIntermediate(index: number, value: LocationDraft) {
    setRawOverride(null);
    setIntermediates((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  async function submit() {
    let request: unknown;
    try {
      request =
        rawOverride === null ? generatedRequest : JSON.parse(rawOverride);
      if (!request) {
        throw new Error('Origin, destination, and coordinates are required.');
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Request must be valid JSON.',
      );
      return;
    }

    setError('');
    try {
      await onCreate(request);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to submit route request',
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
      title={title}
      {...(dark ? { portalClassName: Classes.DARK } : {})}
    >
      <DialogBody>
        <p className={Classes.TEXT_MUTED}>{description}</p>

        <LocationEditor
          label="Origin"
          onChange={(value) => {
            setRawOverride(null);
            setOrigin(value);
          }}
          value={origin}
        />

        <div className="route-waypoint-heading">
          <strong>Intermediates</strong>
          <Button
            disabled={intermediates.length >= 25}
            icon="plus"
            onClick={() => {
              setRawOverride(null);
              setIntermediates((current) => [...current, newLocation()]);
            }}
            size="small"
            variant="minimal"
          >
            Add
          </Button>
        </div>
        {intermediates.length === 0 && (
          <p className={`${Classes.TEXT_MUTED} route-waypoint-empty`}>
            No intermediate stops.
          </p>
        )}
        {intermediates.map((intermediate, index) => (
          <div className="route-waypoint-row" key={index}>
            <LocationEditor
              compact
              label={`Intermediate ${index + 1}`}
              onChange={(value) => updateIntermediate(index, value)}
              value={intermediate}
            />
            <Button
              aria-label={`Remove intermediate ${index + 1}`}
              icon="trash"
              intent={Intent.DANGER}
              onClick={() => {
                setRawOverride(null);
                setIntermediates((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
              size="small"
              variant="minimal"
            />
          </div>
        ))}

        <LocationEditor
          label="Destination"
          onChange={(value) => {
            setRawOverride(null);
            setDestination(value);
          }}
          value={destination}
        />

        <div className="route-job-options">
          <FormGroup label="Travel mode" labelFor="route-travel-mode">
            <HTMLSelect
              fill
              id="route-travel-mode"
              onChange={(event) => {
                setRawOverride(null);
                const nextMode = event.target.value as RouteTravelMode;
                setTravelMode(nextMode);
                if (nextMode !== 'DRIVING') setRoutingPreference('');
              }}
              options={modeOptions}
              value={travelMode}
            />
          </FormGroup>
          <Switch
            checked={alternatives}
            label="Alternative routes"
            onChange={(event) => {
              setRawOverride(null);
              setAlternatives(event.currentTarget.checked);
            }}
          />
        </div>

        <details className="route-advanced-options">
          <summary>Advanced options &amp; raw JSON</summary>
          <div className="route-advanced-grid">
            <FormGroup label="Language code" labelFor="route-language">
              <InputGroup
                id="route-language"
                onChange={(event) => {
                  setRawOverride(null);
                  setLanguageCode(event.target.value);
                }}
                value={languageCode}
              />
            </FormGroup>
            <FormGroup label="Region code" labelFor="route-region">
              <InputGroup
                id="route-region"
                onChange={(event) => {
                  setRawOverride(null);
                  setRegionCode(event.target.value);
                }}
                value={regionCode}
              />
            </FormGroup>
            <FormGroup label="Departure time" labelFor="route-departure">
              <InputGroup
                id="route-departure"
                onChange={(event) => {
                  setRawOverride(null);
                  setDepartureTime(event.target.value);
                }}
                type="datetime-local"
                value={departureTime}
              />
            </FormGroup>
            <FormGroup
              label="Routing preference"
              labelFor="route-routing-preference"
            >
              <HTMLSelect
                disabled={travelMode !== 'DRIVING'}
                fill
                id="route-routing-preference"
                onChange={(event) => {
                  setRawOverride(null);
                  setRoutingPreference(event.target.value);
                }}
                options={[
                  { value: '', label: 'Google default' },
                  { value: 'TRAFFIC_AWARE', label: 'Traffic aware' },
                  {
                    value: 'TRAFFIC_AWARE_OPTIMAL',
                    label: 'Traffic aware optimal',
                  },
                  { value: 'TRAFFIC_UNAWARE', label: 'Traffic unaware' },
                ]}
                value={routingPreference}
              />
            </FormGroup>
          </div>
          <div className="route-raw-editor-heading">
            <span>Request JSON</span>
            {rawOverride !== null && (
              <Button
                onClick={() => setRawOverride(null)}
                size="small"
                variant="minimal"
              >
                Reset from form
              </Button>
            )}
          </div>
          <textarea
            aria-label="Route request JSON"
            className={`${Classes.INPUT} route-request-editor`}
            onChange={(event) => setRawOverride(event.target.value)}
            spellCheck={false}
            value={rawOverride ?? generatedJson}
          />
        </details>

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
              {submitLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

function LocationEditor({
  label,
  value,
  compact = false,
  onChange,
}: {
  label: string;
  value: LocationDraft;
  compact?: boolean;
  onChange: (value: LocationDraft) => void;
}) {
  return (
    <FormGroup
      className={compact ? 'route-location-compact' : ''}
      label={label}
    >
      <div className="route-location-editor">
        <HTMLSelect
          aria-label={`${label} type`}
          onChange={(event) =>
            onChange({ ...value, type: event.target.value as LocationKind })
          }
          options={[
            { value: 'address', label: 'Address' },
            { value: 'coordinates', label: 'Coordinates' },
            { value: 'placeId', label: 'Place ID' },
          ]}
          value={value.type}
        />
        {value.type === 'address' && (
          <InputGroup
            aria-label={`${label} address`}
            fill
            onChange={(event) =>
              onChange({ ...value, address: event.target.value })
            }
            placeholder="東京駅、日本"
            value={value.address}
          />
        )}
        {value.type === 'placeId' && (
          <InputGroup
            aria-label={`${label} place ID`}
            fill
            onChange={(event) =>
              onChange({ ...value, placeId: event.target.value })
            }
            placeholder="Google Place ID"
            value={value.placeId}
          />
        )}
        {value.type === 'coordinates' && (
          <div className="route-coordinate-inputs">
            <InputGroup
              aria-label={`${label} latitude`}
              fill
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, latitude: event.target.value })
              }
              placeholder="Latitude"
              value={value.latitude}
            />
            <InputGroup
              aria-label={`${label} longitude`}
              fill
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...value, longitude: event.target.value })
              }
              placeholder="Longitude"
              value={value.longitude}
            />
          </div>
        )}
      </div>
    </FormGroup>
  );
}

function toLocation(value: LocationDraft, label: string): RouteLocation {
  if (value.type === 'address') {
    if (!value.address.trim()) throw new Error(`${label} address is required.`);
    return { type: 'address', address: value.address.trim() };
  }
  if (value.type === 'placeId') {
    if (!value.placeId.trim())
      throw new Error(`${label} Place ID is required.`);
    return { type: 'placeId', placeId: value.placeId.trim() };
  }
  if (!value.latitude.trim() || !value.longitude.trim()) {
    throw new Error(`${label} coordinates are required.`);
  }
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(`${label} coordinates are invalid.`);
  }
  return { type: 'coordinates', latitude, longitude };
}

function buildRequest(input: {
  origin: LocationDraft;
  destination: LocationDraft;
  intermediates: LocationDraft[];
  travelMode: RouteTravelMode;
  alternatives: boolean;
  languageCode: string;
  regionCode: string;
  departureTime: string;
  routingPreference: string;
}): RouteRequest {
  return {
    origin: toLocation(input.origin, 'Origin'),
    intermediates: input.intermediates.map((location, index) =>
      toLocation(location, `Intermediate ${index + 1}`),
    ),
    destination: toLocation(input.destination, 'Destination'),
    travelMode: input.travelMode,
    computeAlternativeRoutes: input.alternatives,
    ...(input.languageCode.trim()
      ? { languageCode: input.languageCode.trim() }
      : {}),
    ...(input.regionCode.trim() ? { regionCode: input.regionCode.trim() } : {}),
    ...(input.departureTime
      ? { departureTime: new Date(input.departureTime).toISOString() }
      : {}),
    ...(input.routingPreference
      ? { routingPreference: input.routingPreference }
      : {}),
  };
}
