# Getting Started

This guide runs tcache with the built-in mock providers, then shows where to
configure real upstream services.

## Requirements

- Node.js 22 or later
- pnpm 10.15.1 through Corepack
- Redis 7 or later
- PostgreSQL 17 or a compatible supported version when Route analytics are
  required
- Docker with Compose v2 for the containerized setup

## Local development

Install dependencies:

```sh
corepack enable
pnpm install
```

Run Redis on `localhost:6379`. For example, with Docker:

```sh
docker run --rm -p 6379:6379 redis:7-alpine
```

In another terminal, start the server and testbed:

```sh
pnpm dev
```

The local defaults are `ROUTE_PROVIDER=mock` and `AI_PROVIDER=mock`. The server
listens on <http://localhost:3200>; the Vite testbed listens on
<http://localhost:3201> and proxies `/api` and `/health` to the server.

The Node.js server reads `process.env` directly and does not load `.env` by
itself. `.env.example` is a configuration reference and is consumed by Docker
Compose, but local provider overrides must be exported in the shell that starts
the server. For example:

```sh
ROUTE_PROVIDER=google GOOGLE_MAPS_API_KEY=... pnpm dev:server
```

PowerShell equivalent:

```powershell
$env:ROUTE_PROVIDER = 'google'
$env:GOOGLE_MAPS_API_KEY = '...'
pnpm dev:server
```

PostgreSQL is optional in development. If `DATABASE_URL` is absent, the core
server and Redis-backed APIs still start, Route analytics endpoints are not
registered, and `/status` reports PostgreSQL as unavailable. PostgreSQL is
required when `NODE_ENV=production`.

## Docker Compose

Create a local `.env` file with at least:

```dotenv
POSTGRES_PASSWORD=tcache-local
DATABASE_URL=postgresql://tcache:tcache-local@postgres:5432/tcache
ROUTE_PROVIDER=mock
AI_PROVIDER=mock
```

Start the complete stack:

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3200/health
curl http://127.0.0.1:3200/status
```

Compose runs the Fastify server, React/Nginx testbed, Redis, and PostgreSQL.
Only the server and testbed are published, both on loopback by default:

- Server: <http://127.0.0.1:3200>
- Testbed: <http://127.0.0.1:3201>

Redis and PostgreSQL remain on the internal Compose network. Their data is
stored in named volumes.

## Verify the APIs

Create a Route Job:

```sh
curl -X POST http://127.0.0.1:3200/api/route/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "locations": [
      {"coordinates":{"latitude":37.5665,"longitude":126.9780},"name":"Seoul City Hall"},
      {"coordinates":{"latitude":37.5547,"longitude":126.9707},"name":"Seoul Station"}
    ],
    "mode": "DRIVING",
    "countryCode": "KR",
    "departureTime": "2027-01-15T09:00:00+09:00"
  }'
```

The response is `202 Accepted`:

```json
{
  "jobId": "route_<uuid>",
  "status": "queued",
  "eventsUrl": "/api/route/jobs/route_<uuid>/events",
  "resultUrl": "/api/route/jobs/route_<uuid>/result"
}
```

Use the returned URLs:

```sh
curl -N http://127.0.0.1:3200/api/route/jobs/<jobId>/events
curl http://127.0.0.1:3200/api/route/jobs/<jobId>/result
```

Create an AI Job:

```sh
curl -X POST http://127.0.0.1:3200/api/ai/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "mock",
    "model": "mock-ai-v1",
    "messages": [{"role":"user","content":"Summarize the purpose of a route cache."}],
    "cache": {"enabled": true}
  }'
```

The response uses the same pattern with an `ai_<uuid>` Job ID and paths under
`/api/ai/jobs`.

## Testbed

The testbed exposes these pages:

| Path               | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `/`                | Service overview                                |
| `/route`           | Multi-provider Route request playground         |
| `/route/matrix`    | Directed Matrix Job playground                  |
| `/route/jobs`      | Route Job lifecycle and result viewer           |
| `/route/cache`     | Read-only Redis Route cache explorer            |
| `/route/analytics` | PostgreSQL Route analytics                      |
| `/ai`              | AI Job playground                               |
| `/status`          | Version, Redis, PostgreSQL, and provider status |

`VITE_GOOGLE_MAPS_API_KEY` is only used by the browser map. Restrict it to the
Maps JavaScript API and the expected web origins; it is separate from the
server-side `GOOGLE_MAPS_API_KEY`.

## Development commands

| Command             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Run server and testbed together                        |
| `pnpm dev:server`   | Run only the Fastify server                            |
| `pnpm dev:testbed`  | Run only the Vite testbed                              |
| `pnpm lint`         | Run ESLint                                             |
| `pnpm format:check` | Check Prettier formatting                              |
| `pnpm typecheck`    | Type-check all workspaces                              |
| `pnpm test`         | Run endpoint, provider, and OTP smoke-evaluation tests |
| `pnpm build`        | Build all workspaces                                   |

The normal test suite uses fixture HTTP responses and does not call live Route
providers. With the experimental OTP server already running, opt into its live
provider check with:

```sh
RUN_LIVE_ROUTE_PROVIDER_TESTS=true \
OTP_BASE_URL=http://127.0.0.1:8080 \
pnpm --filter @tcache/server exec vitest run \
  route/server/otp-provider.test.ts --root ../..
```

Matrix testbed presets are generated from troute's
`tests/fixtures/places/*_10_places.json`. The Tokyo and Seoul 3/5/10-location
presets retain the same IDs and ordering as troute. Do not hand-edit
`route/testbed/matrix/place-fixtures.generated.ts`; regenerate it from the
troute repository with:

```sh
node scripts/generate_testbed_place_presets.mjs
```

The source layout keeps Route and AI implementations independent:

```text
route/server/         Route providers, cache, Jobs, Matrix, analytics API
route/testbed/        Route and Matrix testbed features
ai/server/            AI providers, cache, and Jobs
ai/testbed/           AI testbed features
apps/server/src/      Fastify composition, Redis, PostgreSQL, health
apps/testbed/src/     React/Vite application shell
packages/common/      Cross-cutting public types
deploy/               Docker, Nginx, and Cloudflare examples
otp/                  Experimental OpenTripPlanner Tokyo environment
```

For endpoint details, continue with the [API Reference](api.md). For real
providers and policy settings, see [Configuration](configuration.md).
