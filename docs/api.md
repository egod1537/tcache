# API Reference

tcache exposes health endpoints at the server root and separate Route and AI
namespaces. Job creation is asynchronous: a successful submission returns
`202 Accepted`, an ID, an SSE URL, and a result URL.

## Service endpoints

| Method | Path              | Description                                                                      |
| ------ | ----------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/health`         | Process/container liveness; returns `{ "status": "ok" }`                         |
| `GET`  | `/status`         | Service version, environment, uptime, Redis status, and cached PostgreSQL health |
| `GET`  | `/api/route/ping` | Route subsystem ping                                                             |
| `GET`  | `/api/ai/ping`    | AI subsystem ping                                                                |

PostgreSQL health is refreshed in the background with `SELECT 1`; `/status`
does not query the database on every request.

## Route Jobs

| Method | Path                            | Description                                             |
| ------ | ------------------------------- | ------------------------------------------------------- |
| `POST` | `/api/route/jobs`               | Validate a request, select a provider, and create a Job |
| `GET`  | `/api/route/jobs?limit=<n>`     | List recent Route Jobs                                  |
| `GET`  | `/api/route/jobs/:jobId`        | Get the current Job snapshot                            |
| `GET`  | `/api/route/jobs/:jobId/events` | Stream Job events over SSE                              |
| `GET`  | `/api/route/jobs/:jobId/result` | Get a terminal result or current status                 |
| `POST` | `/api/route/jobs/:jobId/cancel` | Cancel a queued or running Job                          |

### Request

The preferred request contract uses ordered `locations`. The first item is the
origin, the last is the destination, and any items between them are
intermediates.

```json
{
  "locations": [
    {
      "coordinates": { "latitude": 37.5665, "longitude": 126.978 },
      "name": "Seoul City Hall"
    },
    {
      "coordinates": { "latitude": 37.5547, "longitude": 126.9707 },
      "name": "Seoul Station"
    }
  ],
  "mode": "DRIVING",
  "countryCode": "KR",
  "timeZone": "Asia/Seoul",
  "departureTime": "2027-01-15T09:00:00+09:00",
  "computeAlternativeRoutes": false,
  "languageCode": "en",
  "regionCode": "KR",
  "units": "METRIC",
  "options": {}
}
```

Required fields and validation:

- `locations` contains 2 to 27 items. Provider-specific limits are checked
  after selection.
- `mode` is `DRIVING`, `WALKING`, `BICYCLING`, or `TRANSIT`.
- `departureTime` is an ISO-8601 date-time with `Z` or an explicit timezone
  offset.
- `countryCode`, when present, is an ISO 3166-1 alpha-2 code.
- `timeZone`, when present, is an IANA timezone.
- `routingPreference` is accepted only for `DRIVING`. When Google is selected,
  a request with `departureTime` and no preference is normalized to
  `TRAFFIC_AWARE`. `departureTime` with an explicit `TRAFFIC_UNAWARE` is
  rejected with `INVALID_ROUTE_OPTIONS` before a Job or provider call is made.

A location may contain coordinates, a name, an address, or provider-specific
IDs:

```json
{
  "coordinates": { "latitude": 35.681236, "longitude": 139.767125 },
  "name": "Tokyo Station",
  "address": "Tokyo Station, Japan",
  "externalIds": {
    "googlePlaceId": "...",
    "kakaoPlaceId": "...",
    "navitimeId": "...",
    "ekispertId": "..."
  }
}
```

Provider-specific identifiers are not reused across providers. Coordinates
take precedence for cache identity. Kakao and OTP require coordinates;
NAVITIME accepts coordinates or `navitimeId`; Ekispert accepts `ekispertId`,
coordinates, address, or name. Google accepts coordinates, address, or
`googlePlaceId`.

The legacy `origin` / `intermediates` / `destination` / `travelMode` contract,
flat `latitude` / `longitude`, and `placeId` remain accepted for existing
clients. New clients should use the ordered contract above.

### Provider selection

When `ROUTE_PROVIDER=auto`, tcache resolves the provider in this order:

1. An allowed request-level `provider`.
2. An explicit `countryCode` and its country/mode policy.
3. A coordinate-resolved country and its country/mode policy.
4. Mode default.
5. Global default.

`regionCode` is a localization/search hint and is never treated as a country
selection input. Coordinate resolution is available for the built-in KR and
JP policy regions only when every route location has coordinates and resolves
to the same country.

The built-in automatic contract is:

| Resolved country | Mode           | Provider         |
| ---------------- | -------------- | ---------------- |
| `KR`             | `DRIVING`      | `kakao-mobility` |
| `KR`             | `WALKING`      | `kakao-maps`     |
| `KR`             | `BICYCLING`    | `kakao-maps`     |
| `KR`             | `TRANSIT`      | `kakao-maps`     |
| `JP`             | `DRIVING`      | `google`         |
| `JP`             | `WALKING`      | `google`         |
| `JP`             | `BICYCLING`    | `google`         |
| `JP`             | `TRANSIT`      | `ekispert`       |
| Other or unknown | supported mode | `google`         |

The Job snapshot includes `resolvedCountryCode` and
`countryResolutionSource` (`explicit`, `coordinates`, or `none`). When no
country can be resolved and a global default is used, `warnings` contains
`COUNTRY_CODE_MISSING`. The normalized request in the snapshot exposes any
provider-dependent option defaults, including Google's `TRAFFIC_AWARE`.

A fixed `ROUTE_PROVIDER` has higher precedence than all policy entries and
rejects request overrides. Selection validates provider availability and
capabilities before creating the Job. There is no automatic fallback after a
selection or an upstream failure.

For example, this invalid Google option combination returns HTTP 400:

```json
{
  "error": {
    "code": "INVALID_ROUTE_OPTIONS",
    "message": "departureTime cannot be used with TRAFFIC_UNAWARE. Remove departureTime or use TRAFFIC_AWARE."
  }
}
```

### Lifecycle and result

Job statuses are `queued`, `running`, `completed`, `failed`, and `cancelled`.
The result endpoint returns:

- `200` with the normalized provider result for a completed Job.
- `202` while a Route Job is queued or running.
- `409` with a limited error object after failure or cancellation.
- `404` when the Job has expired or does not exist.

The response reports the selected provider, cache hit/miss metadata, and
provider latency where applicable. The upstream provider response is redacted
and exposed only when `ROUTE_PROVIDER_RAW_DEBUG_ENABLED=true`.

SSE event names are `snapshot`, `progress`, `completed`, `failed`, and
`cancelled`. A comment heartbeat is sent every 15 seconds. The first event is
the latest Redis snapshot, so reconnecting does not require replaying an
in-memory event log. Closing the SSE connection does not cancel the Job.

## Travel-time Matrix Jobs

| Method | Path                                   | Description                            |
| ------ | -------------------------------------- | -------------------------------------- |
| `POST` | `/api/route/matrix/jobs`               | Create a directed all-pairs Matrix Job |
| `GET`  | `/api/route/matrix/jobs/:jobId`        | Get Matrix Job status and progress     |
| `GET`  | `/api/route/matrix/jobs/:jobId/events` | Stream Matrix Job SSE events           |
| `GET`  | `/api/route/matrix/jobs/:jobId/result` | Get the completed matrix               |
| `POST` | `/api/route/matrix/jobs/:jobId/cancel` | Cancel the Matrix Job                  |

```json
{
  "locations": [
    {
      "id": "city-hall",
      "coordinates": { "latitude": 37.5665, "longitude": 126.978 }
    },
    {
      "id": "seoul-station",
      "coordinates": { "latitude": 37.5547, "longitude": 126.9707 }
    }
  ],
  "mode": "DRIVING",
  "countryCode": "KR",
  "departureTime": "2027-01-15T09:00:00+09:00",
  "options": { "languageCode": "en", "regionCode": "KR" }
}
```

Matrix requests contain 2 to 20 locations with unique `id` values. tcache
calculates every directed pair, writes zero on the diagonal without calling a
provider, and preserves input order in the square `durationSeconds` matrix.
Each pair uses the normal Route provider, cache key, and TTL. Pair execution is
bounded by `TCACHE_MATRIX_CONCURRENCY`; if any pair fails, the complete Matrix
Job fails instead of returning a partial matrix.

Unlike the Route result endpoint, a non-completed Matrix result returns `409`.

## Provider and cache inspection

| Method | Path                               | Description                                                                           |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `GET`  | `/api/route/providers`             | Registered providers, capabilities, availability, and fallback policy                 |
| `GET`  | `/api/route/providers/diagnostics` | Provider configuration and adapter-specific diagnostics; OTP also checks reachability |
| `GET`  | `/api/route/providers/policy`      | Active fixed/auto mode, policy source, assignments, and availability                  |
| `GET`  | `/api/route/cache?limit=<n>`       | List Route cache metadata without mutating entries                                    |
| `GET`  | `/api/route/cache/entry?key=<key>` | Read one Route cache entry                                                            |

The cache explorer is read-only. Redis stores entries under
`tcache:route:cache:` followed by the public `route:v4:...` key.

### Google provider debug endpoint

`POST /api/route/provider/google/compute` normalizes a Route request and calls
the Google adapter directly. It is intended for the Route playground and
provider validation. It bypasses Job persistence, SSE, the Route result cache,
and PostgreSQL analytics. The response always contains the normalized request
and routes. Redacted provider request data, field mask, latency, and raw output
are retained only when `ROUTE_PROVIDER_RAW_DEBUG_ENABLED=true`.

```sh
curl -X POST http://127.0.0.1:3200/api/route/provider/google/compute \
  -H 'Content-Type: application/json' \
  -d '{
    "locations": [
      {"address":"Tokyo Station, Japan"},
      {"address":"Tokyo Tower, Japan"}
    ],
    "mode": "DRIVING",
    "departureTime": "2027-01-15T14:23:00+09:00",
    "computeAlternativeRoutes": true
  }'
```

## Route analytics

These read-only endpoints are registered only when `DATABASE_URL` is set:

| Method | Path                              | Description                                           |
| ------ | --------------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/route/analytics/summary`    | Request, success, failure, latency, and cache summary |
| `GET`  | `/api/route/analytics/timeseries` | Hourly or daily request series                        |
| `GET`  | `/api/route/analytics/modes`      | Per-mode request and cache-hit metrics                |
| `GET`  | `/api/route/analytics/top-routes` | Most requested canonical origin/destination pairs     |
| `GET`  | `/api/route/analytics/errors`     | Counts by limited error code                          |
| `GET`  | `/api/route/analytics/recent`     | Recent Route request metadata                         |

All endpoints accept `from`, `to`, `mode`, `provider`, and `status` filters.
The default range is the last 24 hours and the maximum range is 90 days.
`timeseries` accepts `interval=hour|day`. `top-routes` accepts a maximum
`limit` of 100 and `recent` a maximum of 200.

PostgreSQL stores Route request metadata and lifecycle outcomes, not Route
cache bodies, provider response bodies, or AI requests. An analytics write
failure is logged and does not turn a successful Route Job into a failure.

## AI Jobs

| Method | Path                                 | Description                                            |
| ------ | ------------------------------------ | ------------------------------------------------------ |
| `POST` | `/api/ai/jobs`                       | Normalize an AI request and create a Job               |
| `GET`  | `/api/ai/jobs?limit=<n>`             | List recent AI Jobs                                    |
| `GET`  | `/api/ai/jobs/:jobId`                | Get a privacy-limited Job snapshot                     |
| `GET`  | `/api/ai/jobs/:jobId/events`         | Stream AI Job events over SSE                          |
| `GET`  | `/api/ai/jobs/:jobId/result`         | Get the terminal AI result                             |
| `POST` | `/api/ai/jobs/:jobId/cancel`         | Cancel a queued or running Job                         |
| `GET`  | `/api/ai/providers/openwebui/models` | Discover models from the configured OpenWebUI instance |

```json
{
  "provider": "mock",
  "model": "mock-ai-v1",
  "systemPrompt": "Answer concisely.",
  "promptVersion": "v1",
  "messages": [{ "role": "user", "content": "What does a route cache avoid?" }],
  "options": { "temperature": 0.2 },
  "tools": [],
  "cache": { "enabled": true }
}
```

`messages` must be a non-empty array. `provider` and `model` may be omitted
when defaults exist for the active provider. `options` defaults to `{}` and
`cache.enabled` defaults to `true`. `tools` must be an array when present;
`responseSchema` may contain a provider-specific schema.

The Job snapshot and SSE payload expose request metadata such as the prompt
hash, message count, option keys, tool count, provider, and model instead of
raw prompts. The result endpoint uses `Cache-Control: no-store` and returns the
full normalized request, extracted `text` when available, and raw normalized
provider result. Clients should treat the result endpoint as sensitive.

AI result status codes are `200` when completed, `202` while pending, `409`
after failure/cancellation, and `404` when missing. AI SSE uses the same event
names and heartbeat behavior as Route SSE. It reports Job progress, not token
streaming.
