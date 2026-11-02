# Deployment

The checked-in deployment targets one Docker Compose host. The public entry
point is the testbed's Nginx container, which serves the React application and
proxies API requests to the Fastify server.

```text
Internet -> Cloudflare HTTPS/Tunnel -> 127.0.0.1:3201
                                      `- testbed Nginx
                                         |- React static files
                                         `- /api, /health -> tcache-server:3200
                                                               |- redis:6379
                                                               `- postgres:5432
```

## Docker Compose

Create `.env` before starting the production topology. At minimum, Compose
requires both PostgreSQL values:

```dotenv
POSTGRES_PASSWORD=replace-me
DATABASE_URL=postgresql://tcache:replace-me@postgres:5432/tcache
```

Add provider policy and credentials for the traffic the deployment accepts.
For the built-in production policy this normally includes:

```dotenv
ROUTE_PROVIDER=auto
ROUTE_PROVIDER_OVERRIDE_ENABLED=false
GOOGLE_MAPS_API_KEY=...
KAKAO_REST_API_KEY=...
KAKAO_MOBILITY_API_KEY=...
EKISPERT_API_KEY=...

AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

Start and verify the services:

```sh
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3200/health
curl --fail http://127.0.0.1:3200/status
```

Compose runs:

- `tcache-server` on `127.0.0.1:${TCACHE_PORT:-3200}`;
- `tcache-testbed` on `127.0.0.1:${TCACHE_TESTBED_PORT:-3201}`;
- Redis 7 with append-only persistence in `redis-data`;
- PostgreSQL 17 in `postgres-data`.

Redis and PostgreSQL do not publish host ports. Both application ports bind to
loopback. Keep firewall rules and tunnel routing consistent with that boundary.

`docker compose down` preserves both named volumes. `docker compose down -v`
deletes the Redis and PostgreSQL volumes and must not be used when the stored
Jobs, caches, or analytics data need to be retained.

The server container runs as the unprivileged Node user. Its health check calls
`/health`; the testbed waits for that check before starting. The Nginx proxy
maps `/api/status` to the server's root `/status`, while other `/api/*` paths
are forwarded unchanged.

## Production requirements

- Redis must be reachable before the server starts.
- `DATABASE_URL` is required when `NODE_ENV=production`.
- Migrations must succeed before the HTTP listener starts.
- Every provider reachable through the active policy should have its required
  credential. Missing configuration is visible in the provider catalog but
  causes selected Jobs to fail; there is no fallback.
- `ROUTE_PROVIDER_RAW_DEBUG_ENABLED` should normally remain `false`.
- `VITE_GOOGLE_MAPS_API_KEY` is embedded at testbed image build time. Apply
  browser-origin and Maps JavaScript API restrictions.

The Compose defaults are `ROUTE_PROVIDER=auto`,
`ROUTE_PROVIDER_OVERRIDE_ENABLED=false`, `AI_PROVIDER=gemini`, and
`NODE_ENV=production`. These differ from a local server started without an
environment, which uses the mock providers.

## Experimental OTP overlay

OpenTripPlanner is isolated from the default production topology. Build the
Tokyo graph described in [the OTP PoC](../otp/README.md), then start the overlay:

```sh
docker compose \
  -f docker-compose.yml \
  -f docker-compose.otp.yml \
  --profile otp up -d --build
```

The overlay runs the pinned OTP 2.10.0 image, mounts `otp/data/tokyo` read-only,
sets `OTP_BASE_URL=http://otp:8080` inside the server, and enables the OTP
adapter. It does not change the built-in provider policy; select OTP through an
explicit development override or a deliberate policy change.

OTP availability does not affect `/health`. Use
`GET /api/route/providers/diagnostics` for configured/reachable status. Apply
the generated `tcache.env` manifest after a graph rebuild so version and
dataset identities invalidate stale OTP cache entries.

## Cloudflare Tunnel

The example under [`deploy/cloudflare`](../deploy/cloudflare/README.md) maps
`tcache.mangagaki.net` to the loopback-only testbed port. Store the tunnel ID,
token, JSON credential, and the real Cloudflare configuration outside the
repository. Run `cloudflared` as a managed host service.

The tunnel should forward to `127.0.0.1:3201`, not directly to Redis,
PostgreSQL, or the Fastify port. Nginx remains the public HTTP boundary.

## GitHub Actions

`.github/workflows/ci-deploy.yml` runs on pull requests and pushes to `main`.
The CI job uses Node.js 22 and pnpm 10.15.1, then runs:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

After CI succeeds on `main`, the deployment job runs on a self-hosted macOS
runner, builds images before replacing services, starts Compose, checks
`/health`, and verifies the live provider policy. The Git commit SHA is passed
as `GIT_COMMIT_SHA` and appears in `/status`.

The current production verification requires:

- `ROUTE_PROVIDER=auto`;
- `ROUTE_PROVIDER_OVERRIDE_ENABLED=true` for troute request-level provider
  selection;
- the built-in policy, without deprecated `JAPAN_TRANSIT_PROVIDER` changes;
- configured Google, Kakao Maps, and Kakao Mobility credentials;
- correct Japan/South Korea policy assignments.

The `production` GitHub Environment should contain database and provider
secrets, while non-secret policy/model values can use Actions variables.
`DATABASE_URL` must use the Compose DNS name `postgres:5432` and a URL-encoded
password. The runner needs the `macOS` label and access to Docker.

## PostgreSQL migrations

SQL migrations live in `apps/server/src/db/migrations` with four-digit ordered
versions. The server applies them after Redis connects and before HTTP listen.
Each deployment:

1. opens a transaction;
2. takes a PostgreSQL advisory transaction lock;
3. creates `schema_migrations` when needed;
4. verifies the SHA-256 checksum of every previously applied migration;
5. applies new migrations in version order;
6. commits only when all steps succeed.

A changed applied migration, duplicate version, failed SQL statement, or
detected `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`, `DROP COLUMN`, or
`TRUNCATE` statement stops startup. The deployment health check therefore
fails instead of serving against an unknown schema.

Current migrations create the `route_requests` analytics table and indexes,
then add provider-selection source and country metadata. Route/AI cache bodies
and live Job state remain in Redis.

Run migrations against an explicitly selected database without starting the
server:

```sh
DATABASE_URL=postgresql://tcache:password@127.0.0.1:5432/tcache \
  pnpm --filter @tcache/server db:migrate
```

The command is idempotent for unchanged, already-applied versions.

## PostgreSQL backup and restore

Until an external backup system is configured, create a custom-format dump:

```sh
docker compose exec -T postgres \
  pg_dump -U tcache -d tcache -Fc > tcache.dump
```

Before restoring, preserve the current database separately and stop the server
to prevent writes. The following command uses `--clean` and replaces existing
database objects:

```sh
docker compose stop tcache-server
docker compose exec -T postgres pg_restore \
  -U tcache -d tcache --clean --if-exists < tcache.dump
docker compose start tcache-server
```

The Compose database and user are both named `tcache`; PostgreSQL stores its
data at `/var/lib/postgresql/data` in the `postgres-data` volume.
