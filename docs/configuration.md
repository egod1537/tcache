# Configuration

tcache reads configuration from `process.env` when the server starts. The
server does not load `.env` by itself. Docker Compose reads the root `.env`
file and passes the supported values into the production container; local
`pnpm dev:server` runs must receive variables from the launching shell or a
separate environment loader.

`.env.example` is the canonical example. Do not commit `.env`, provider keys,
database passwords, or tunnel credentials.

## Core services

| Variable              | Runtime default          | Description                                                            |
| --------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `NODE_ENV`            | `development`            | Runtime environment. PostgreSQL is mandatory when set to `production`. |
| `TCACHE_PORT`         | `3200`                   | Fastify listen port and default Compose host port                      |
| `TCACHE_TESTBED_PORT` | `3201`                   | Compose host port for the testbed                                      |
| `REDIS_URL`           | `redis://localhost:6379` | Redis connection used by all Jobs and caches                           |
| `DATABASE_URL`        | empty                    | PostgreSQL connection for migrations, health, and Route analytics      |
| `POSTGRES_PASSWORD`   | none                     | Compose-only password used to initialize the `tcache` database user    |
| `GIT_COMMIT_SHA`      | `dev`                    | Version reported by `/status`                                          |

Redis is required. The server connects before listening and does not provide an
in-memory production fallback. PostgreSQL is optional in development; without
it, analytics routes are omitted and `/status` reports an error for PostgreSQL.

In Compose, use the internal service names:

```dotenv
POSTGRES_PASSWORD=replace-me
DATABASE_URL=postgresql://tcache:replace-me@postgres:5432/tcache
```

URL-encode reserved characters in the password embedded in `DATABASE_URL`.
Changing `POSTGRES_PASSWORD` after the `postgres-data` volume has been
initialized does not change the existing PostgreSQL role password.

## Job, cache, and timeout settings

| Variable                       | Default  | Description                                         |
| ------------------------------ | -------- | --------------------------------------------------- |
| `ROUTE_JOB_TTL_SECONDS`        | `86400`  | Redis retention for Route and Matrix Job records    |
| `ROUTE_CACHE_TTL_SECONDS`      | `3600`   | Redis TTL for Route results                         |
| `ROUTE_PROVIDER_TIMEOUT_MS`    | `30000`  | Shared upstream timeout for Route providers         |
| `TCACHE_MATRIX_CONCURRENCY`    | `4`      | Maximum concurrent directed pairs in one Matrix Job |
| `AI_JOB_TTL_SECONDS`           | `86400`  | Redis retention for AI Job records                  |
| `AI_CACHE_DEFAULT_TTL_SECONDS` | `3600`   | Redis TTL for AI responses                          |
| `AI_PROVIDER_TIMEOUT_MS`       | `120000` | Upstream AI provider timeout                        |

All TTL values are positive integers in seconds. Job and result-cache TTLs are
independent. Saving a Job state refreshes that Job record's Redis TTL; cache
entries retain the configured result TTL.

## Route provider selection

| Variable                           | Default                                      | Description                                                                                                             |
| ---------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ROUTE_PROVIDER`                   | `mock` in development; `auto` in production  | Use `auto` policy selection or force `google`, `kakao-mobility`, `kakao-maps`, `ekispert`, `navitime`, `otp`, or `mock` |
| `ROUTE_PROVIDER_POLICY_JSON`       | built-in policy                              | Validated country/mode provider policy                                                                                  |
| `ROUTE_PROVIDER_OVERRIDE_ENABLED`  | `true` in development; `false` in production | Allow the request's `provider` field when `ROUTE_PROVIDER=auto`                                                         |
| `JAPAN_TRANSIT_PROVIDER`           | `ekispert`                                   | Deprecated compatibility setting; use policy JSON instead                                                               |
| `ROUTE_PROVIDER_RAW_DEBUG_ENABLED` | `true` in development; `false` in production | Include redacted raw provider output in debug/result data                                                               |
| `ROUTE_TIME_ZONE`                  | `Asia/Seoul`                                 | Final timezone fallback for cache bucketing and analytics                                                               |

The checked-in `.env.example` explicitly sets `ROUTE_PROVIDER=auto`,
`ROUTE_PROVIDER_OVERRIDE_ENABLED=false`, and
`ROUTE_PROVIDER_RAW_DEBUG_ENABLED=false`; those explicit values override the
development runtime defaults above.

The built-in policy is equivalent to:

```json
{
  "countries": {
    "JP": {
      "modes": {
        "DRIVING": "google",
        "WALKING": "google",
        "BICYCLING": "google",
        "TRANSIT": "ekispert"
      }
    },
    "KR": {
      "modes": {
        "DRIVING": "kakao-mobility",
        "WALKING": "kakao-maps",
        "BICYCLING": "kakao-maps",
        "TRANSIT": "kakao-maps"
      }
    }
  },
  "modeDefaults": {
    "DRIVING": "google",
    "WALKING": "google",
    "BICYCLING": "google",
    "TRANSIT": "google"
  },
  "defaultProvider": "google"
}
```

Selection precedence is a fixed `ROUTE_PROVIDER`; in auto mode it is an
allowed request override, explicit `countryCode`, coordinate-resolved country,
country/mode entry, country default, mode default, then the global default.
`regionCode` does not participate in country resolution. Built-in coordinate
resolution covers KR and JP when every location resolves consistently. Policy
JSON is validated at startup. Unknown fields, invalid country codes, invalid
modes, and unregistered providers prevent the server from starting.

Request overrides are checked for provider availability, mode, resolved
country, waypoint/location limits, and required coordinate or identifier
formats before a Route Job is created.

`JAPAN_TRANSIT_PROVIDER` accepts `ekispert`, `navitime`, or `otp`. It is applied
only as a compatibility rule when policy JSON has no explicit `JP + TRANSIT`
entry. The policy endpoint reports whether compatibility was applied.

Provider errors never trigger automatic fallback. A policy may refer to a
registered but unconfigured provider; the server still starts, the catalog
marks it unavailable, and a selected request fails explicitly.

## Route provider settings

| Provider        | Variables                                   | Notes                                                                                                     |
| --------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Google Routes   | `GOOGLE_MAPS_API_KEY`                       | Server-side Routes API credential; separate from the browser map key                                      |
| Kakao Maps      | `KAKAO_REST_API_KEY`                        | Used for South Korea transit, walking, and bicycle requests                                               |
| Kakao Mobility  | `KAKAO_MOBILITY_API_KEY`                    | Used for South Korea driving requests                                                                     |
| Ekispert        | `EKISPERT_API_KEY`, `EKISPERT_API_BASE_URL` | Base URL defaults to `https://api.ekispert.jp`; Standard/Trial `search/course/extreme` access is required |
| NAVITIME        | `NAVITIME_API_KEY`, `NAVITIME_API_BASE_URL` | Base URL defaults to the NAVITIME Total Navi RapidAPI endpoint                                            |
| OpenTripPlanner | Variables below                             | Experimental, self-hosted, and disabled by default                                                        |

Google transit requests with intermediates are split into origin/destination
segments and merged. Connection timing and dwell between those independent
segments are not calculated. Kakao providers require WGS84 coordinates.
NAVITIME accepts its external node ID or coordinates. Ekispert accepts its
external station ID, coordinates, address, or name.

### OpenTripPlanner

| Variable                   | Default                 | Description                                                  |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `OTP_PROVIDER_ENABLED`     | `false`                 | Register OTP as available rather than experimental-disabled  |
| `OTP_BASE_URL`             | `http://localhost:8080` | OTP base URL; tcache calls `/otp/gtfs/v1`                    |
| `OTP_REQUEST_TIMEOUT_MS`   | `30000`                 | OTP-specific GraphQL timeout                                 |
| `OTP_VERSION`              | empty                   | Version exposed in diagnostics and cache metadata            |
| `OTP_GRAPH_BUILD_ID`       | empty                   | Graph identity included in the cache hash seed               |
| `OTP_GTFS_DATASET_VERSION` | empty                   | GTFS dataset identity included in diagnostics/cache metadata |
| `OTP_OSM_DATASET_VERSION`  | empty                   | OSM dataset identity included in diagnostics/cache metadata  |

Change `OTP_GRAPH_BUILD_ID` after every graph rebuild so results from different
graphs do not share a cache entry. The approved build can emit additional
quality, linking, transfer, feed, and regression variables through
`otp/data/japan/tokyo/builds/latest/manifests/tcache.env`. Those values are
diagnostic metadata; they do not promote OTP into the built-in provider policy.
See the [OTP PoC documentation](../otp/README.md).

## AI provider settings

| Variable             | Default                                       | Description                                                                           |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `AI_PROVIDER`        | `mock` in development; `gemini` in production | Default provider when a request omits `provider`                                      |
| `GEMINI_API_KEY`     | empty                                         | Gemini REST API credential                                                            |
| `GEMINI_MODEL`       | `gemini-3.6-flash`                            | Default Gemini model                                                                  |
| `OPENWEBUI_BASE_URL` | empty                                         | OpenWebUI origin, for example `http://host.docker.internal:3000` from Docker on macOS |
| `OPENWEBUI_API_KEY`  | empty                                         | Optional bearer token                                                                 |
| `OPENWEBUI_MODEL`    | empty                                         | Default OpenWebUI model                                                               |

The provider registry contains Gemini, OpenWebUI, and mock regardless of the
default. A request may name any registered provider and a supported model.
Gemini accepts model names beginning with `gemini-`; OpenWebUI accepts any
non-empty model string and calls `/api/chat/completions`. Model discovery uses
`/api/models`. There is no fallback to mock when a configured provider is
missing credentials or unavailable.

## Cache identity

### Route cache

Redis stores Route entries with the prefix `tcache:route:cache:`. The public
identity is:

```text
route:v4:<provider>:<mode>:<country>:<sha256>
```

The SHA-256 input is a stable serialization of:

- selected provider and its optional cache seed, such as OTP graph identity;
- mode, country, and resolved timezone;
- canonical origin, ordered intermediates, and destination;
- alternative-route flag;
- local day type and 10-minute departure-time bucket;
- language, region, driving preference, units, and normalized options.

Provider-dependent normalization runs before key construction. In particular,
Google `DRIVING` requests with `departureTime` default to `TRAFFIC_AWARE`, so
implicit and explicit traffic-aware requests share an identity while different
time buckets and preferences remain isolated.

Coordinates have highest precedence and are rounded to five decimal places.
Otherwise tcache uses the selected provider's external ID, then an NFKC,
whitespace-normalized, lowercase address or name. Timezone resolution uses the
request `timeZone`, the country default (`Asia/Tokyo` for `JP` and
`Asia/Seoul` for `KR`), `ROUTE_TIME_ZONE`, then UTC. Day types are weekday,
Saturday, and Sunday; a holiday hook exists but the default policy does not
classify holidays.

Provider is part of both the visible namespace and the hash. Google, Kakao,
Ekispert, NAVITIME, OTP, and mock results cannot collide or be shared.

Cache values contain the normalized result, provider/adapter version, request
hash, creation and expiry times, and optional provider dataset metadata.

### AI cache

Redis stores AI entries with the prefix `tcache:ai:cache:`. The public identity
is `ai:v1:<sha256>`, computed from a stable serialization of the complete
normalized generation input: provider, model, system prompt, prompt version,
messages, options, tools, and response schema. The `cache` control object is
excluded. `cache.enabled=false` bypasses both lookup and storage.

## Browser testbed

`VITE_GOOGLE_MAPS_API_KEY` is embedded in the testbed build and used only to
render the map. It is public browser configuration, so restrict it by web
origin and API. Do not reuse an unrestricted server-side Routes key.
