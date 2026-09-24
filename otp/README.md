# OpenTripPlanner Tokyo PoC

This directory is an independent OpenTripPlanner experiment. It does not import or call tcache server code and does not register an OTP route provider.

The PoC pins OpenTripPlanner `2.10.0` and Java is supplied by the official container image. OTP reads its base directory from `/var/opentripplanner`, which is mounted from `data/tokyo`. Route checks use the current GTFS GraphQL `planConnection` query at `/otp/gtfs/v1`; the removed REST routing API is not used.

## What this validates

- Build and serve an OTP graph in Docker from Tokyo OSM plus real static GTFS.
- Return ordered walking and transit legs for central Tokyo coordinates.
- Capture import issues, raw GraphQL requests/responses, route metrics, and latency.
- Expose the maintenance and coverage gap relative to commercial Japan transit APIs.

This is intentionally not a nationwide or complete Tokyo journey planner. See [DATA_SOURCES.md](DATA_SOURCES.md) before interpreting route quality.

## Requirements

- Docker with Compose v2
- At least 8 GiB assigned to Docker; the default OTP heap is 6 GiB
- Roughly 3 GiB of free disk for the image, source data, graph, and reports
- `bash`, `curl`, `jq`, and `unzip` on the host

Verified configuration:

| Component          | Pinned/expected value                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| OTP image          | `docker.io/opentripplanner/opentripplanner:2.10.0` pinned to the verified multi-architecture digest |
| OTP base directory | `/var/opentripplanner`                                                                              |
| Graph timezone     | `Asia/Tokyo`                                                                                        |
| API                | GTFS GraphQL `planConnection`                                                                       |
| Realtime           | Disabled; static GTFS only                                                                          |
| Heap               | `-Xmx6g` by default                                                                                 |

Copy `.env.example` to `.env` only when overriding ports, image, or heap. No API key is required for the documented public snapshot URLs.

## Reproduce the PoC

Run every command from this `otp` directory:

```bash
./scripts/download-tokyo-data.sh
./scripts/inspect-feeds.sh
./scripts/build-tokyo.sh
./scripts/run-tokyo.sh
./scripts/query-tokyo.sh
./scripts/benchmark-tokyo.sh
```

Open GraphiQL at <http://localhost:8080/graphiql>. Stop the isolated server with:

```bash
./scripts/stop-tokyo.sh
```

`download-tokyo-data.sh` reuses existing files. Set `FORCE_DOWNLOAD=true` to refresh all mutable snapshots. The script writes `data/tokyo/data-metadata.json` with the download timestamp, byte sizes, and checksums.

The build generates:

- `data/tokyo/graph.obj`
- `data/tokyo/build.log`
- `data/tokyo/build-report/` with OTP import warnings and errors
- `results/latest-build.json` with build duration and graph size
- `results/latest-runtime.json` with startup duration and observed idle memory

These machine-specific artifacts are intentionally ignored by Git. Inspect disconnected stops, stops linked too far away, graph connectivity, and service-date warnings in the report rather than treating a successful process exit as proof of clean data.

## Route verification

`query-tokyo.sh` tests:

- Tokyo Station → Shibuya
- Tokyo Station → Shinjuku
- Shinjuku → Asakusa
- Ueno → Shibuya
- Tokyo Station → Tokyo Tower

The default departure is 10:00 today in `Asia/Tokyo`. Override it with a timezone-bearing ISO-8601 value that is inside the downloaded feeds' service period:

```bash
OTP_DEPARTURE_TIME=2026-09-25T10:00:00+09:00 ./scripts/query-tokyo.sh
```

Each run writes a timestamped directory under `results/` containing:

- exact GraphQL request and response JSON per route
- curl request latency
- itinerary count
- duration, walking time, transfers, transit legs, and operators
- `summary.tsv` and `summary.json`

`results/latest` points to the last run. The first call includes JVM and routing warm-up, so repeat the script for a rough warm p50 rather than treating a single query as a benchmark.

`benchmark-tokyo.sh` runs each test route five times by default and writes per-route and overall p50 latency. Set `OTP_BENCHMARK_ROUNDS` to change the sample count. The recorded reference run and go/no-go assessment are in [POC_RESULTS.md](POC_RESULTS.md).

The committed [request example](examples/tokyo-station-to-tokyo-tower.request.json) and [response example](examples/tokyo-station-to-tokyo-tower.response.json) document the schema used by the verified OTP version.

## Failure checks

With OTP running:

```bash
./scripts/check-failures.sh
```

This records outside-graph and outside-service-period responses. Other expected failures are explicit:

- Missing GTFS: `build-tokyo.sh` refuses to build if either required feed is absent.
- Invalid or disconnected stops: reported by OTP's data import report.
- No route: `routingErrors` and an empty `edges` array remain in the raw response.
- Server exit: stop the Compose service and confirm the GraphQL request fails at the network boundary.

Do not infer “OTP cannot route Tokyo” from an empty response until `inspect-feeds.sh` confirms the requested date lies inside the current feed calendar.

## Configuration notes

`build-config.json` explicitly lists both OSM and GTFS inputs, fixes the graph timezone, bounds the imported service period, and enables the HTML data-import report. It does not scan arbitrary ZIP files. `router-config.json` carries the deployment config version. `otp-config.json` explicitly enables GTFS GraphQL, health checks, and the optional graph report API. Query latency and requests are recorded by the host-side verification scripts.

The service period is relative to graph build time (`-P30D` through `P1Y`). This keeps a useful diagnostic history while preventing stale schedules from silently becoming the test baseline.

## PoC decision criteria

OTP is technically suitable as a future experimental provider if the verified run has all of the following:

- at least three successful routes with both `WALK` and a transit leg
- acceptable warm query latency for the intended workload
- manageable graph build/startup memory and duration
- GTFS coverage that can be refreshed legally and operationally

The current Toei-only scope can validate the OTP pipeline but cannot establish parity with Ekispert or NAVITIME. Adding OTP to tcache is worthwhile only if the team can obtain and continuously maintain licensed JR East, Tokyo Metro, and private railway data. Provider integration, cache-key registration, resolver policy, and response normalization are deliberately outside this directory.
