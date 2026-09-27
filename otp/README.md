# OpenTripPlanner Tokyo PoC

This directory contains the isolated OpenTripPlanner environment plus the local JR East + Toei + Tokyo Metro integration build used by the experimental tcache OTP route provider. OTP remains disabled by default in tcache and is never selected by the production provider policy unless explicitly enabled.

The PoC pins OpenTripPlanner `2.10.0` and Java is supplied by the official container image. OTP reads its base directory from `/var/opentripplanner`, which is mounted from `data/tokyo`. Route checks use the current GTFS GraphQL `planConnection` query at `/otp/gtfs/v1`; the removed REST routing API is not used.

## What this validates

- Build and serve an OTP graph in Docker from Tokyo OSM plus real static GTFS.
- Return ordered walking and transit legs for central Tokyo coordinates.
- Capture import issues, raw GraphQL requests/responses, route metrics, and latency.
- Expose the maintenance and coverage gap relative to commercial Japan transit APIs.

This is intentionally not a nationwide or complete Tokyo journey planner. See [DATA_SOURCES.md](DATA_SOURCES.md) before interpreting route quality.

## JR East research foundation

`tools/jr/` and `schemas/jr/` define a separate JR collection, normalization, and reusable GTFS Schedule generation layer. Local artifacts belong under `data/japan/tokyo/jr-east/`, where raw response bodies, request manifests, normalized datasets, generated feeds, validator reports, and reviewed station mappings remain separated.

This foundation assumes the necessary permission to automate collection for this personal education/research PoC. JR source data and derived GTFS datasets must remain local, must not be redistributed, and must not be used in a commercial service. It covers only the Yamanote PoC, not a whole-network crawler or production deployment.

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

Copy `.env.example` to `.env` only when overriding ports, image, or heap. The
public Toei snapshots need no key. The official Tokyo Metro GTFS requires a
free ODPT developer credential supplied as `TOKYO_METRO_ODPT_KEY`; the key is
never persisted.

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

## JR East + Toei + Tokyo Metro integrated build

After generating the local JR East GTFS, collect the official Tokyo Metro
feed and quality-gate the combined graph with:

```bash
TOKYO_METRO_ODPT_KEY=... ./scripts/fetch-tokyo-metro.sh
OTP_PORT=28081 ./scripts/build-and-approve-integrated-tokyo.sh
```

`build-integrated-tokyo.sh` alone creates or updates the `candidate` symlink; it
never changes the approved `latest` graph. The combined command starts the
candidate, reruns linking metrics, 11 existing smoke cases plus 40 Metro
integration cases, 20 transfer OD regressions, and all reviewed
station-complex walks, then evaluates the
production quality gate. Only a `PASS` candidate is promoted to `latest`. On
failure, the candidate remains available for diagnosis and the previous
approved graph is restarted and retained.

The build uses stable feed IDs `jp-tokyo-jr-east`, `jp-tokyo-toei-rail`,
`jp-tokyo-toei-bus`, and `jp-tokyo-metro`. It runs the pinned official
MobilityData validator against every feed, rejects any validator error, checks
all nine Metro route codes, the service date, coordinates, and feed-ID
uniqueness, then writes the graph only if preflight passes. Original Tokyo
Metro trips, `block_id`, stop hierarchy, platforms, and entrances are preserved
without synthetic through-service merging.

Versioned output is stored at `data/japan/tokyo/builds/<build-id>/` with immutable staged inputs, validator reports, graph/import report, smoke-test JSON and Markdown, input lineage, and `manifests/build-manifest.json`. `data/japan/tokyo/builds/latest` points only to the approved build, while `candidate` points to the most recently built graph. Build identity is derived from OTP version, source hashes, OSM hash, and build configuration rather than wall-clock time.

To connect tcache locally, copy the values from `data/japan/tokyo/builds/latest/manifests/tcache.env` into the server environment. The testbed status page then shows OTP reachability, graph build ID, GTFS/OSM dataset versions, quality-gate status, linking warning counts, regression pass rates, and baseline deltas. This does not alter the default production provider policy.

The integrated smoke suite retains three JR-only routes, three Toei-only
routes, three JR↔Toei transfers, and two routes that include Toei Bus. It adds
20 Metro-internal ODs spanning G/M/H/T/C/Y/Z/N/F, 10 JR↔Metro ODs, and 10
Toei↔Metro ODs. Failures are classified as `GTFS_DATA_ERROR`,
`STATION_MAPPING_ERROR`, `OSM_LINKING_ERROR`, `OTP_BUILD_ERROR`,
`SERVICE_DATE_ERROR`, `TRANSFER_ERROR`, or `ROUTING_QUALITY_ERROR`; incomplete
data is never treated as success.

The approved expanded JR graph also contains Chuo Rapid (JC), Chuo-Sobu Local
(JB), and Keihin-Tohoku/Negishi (JK). Its dedicated suite runs ten
route-specific ODs per new line and requires the requested route code in the
selected itinerary. Collection, mapping, validator, linking, and graph results
are recorded in [reports/jr-east-expansion-report.md](reports/jr-east-expansion-report.md).

Analyze OTP stop/street linking warnings without modifying the graph:

```bash
pnpm --filter @tcache/otp-linking-tools diagnose
```

The reproducible tool and classification limits are documented in [tools/linking/README.md](tools/linking/README.md). Reports are written under `data/japan/tokyo/builds/latest/diagnostics/linking/`.

Reviewed stop-to-OSM corrections live in `config/stop-osm-override-review.json`. The linking tools generate a provenance-complete `stop-osm-overrides.json`, apply only active high-confidence reviewed entries to derived GTFS copies, and refuse a source GTFS hash mismatch. Original GTFS archives remain immutable; low-confidence bus candidates are never applied. The final improvement report, before/after metrics, mapping review CSV, and exact-stop routing regression are generated under the same diagnostics directory. OTP linking thresholds are not changed by this workflow.

Review and verify cross-feed station complexes and transfers with the integrated OTP process running:

```bash
OTP_BASE_URL=http://localhost:18082 ./scripts/check-transfer-quality.sh
```

The workflow expands the reviewed definitions in `config/station-complex-review.json`, keeps automatic name/distance candidates inactive, checks direct pedestrian paths across every reviewed complex, and runs the 20 OD cases in `config/transfer-regression-suite.json`. The suite covers JR→Toei, Toei→JR, Toei line changes, bus→subway, and subway→bus. It rejects different-stop zero-second movement, internal walks over 15 minutes, the wrong feed order, and unexpected transfer stations. Source GTFS archives are not modified, and no explicit transfer rule is produced unless a reviewed path failure demonstrates that one is needed.

Results are written to `data/japan/tokyo/builds/latest/diagnostics/transfers/`: `station-complex-map.json`, `transfer-rules.json`, `transfer-regression-cases.json`, `complex-walk-validation.json`, and `transfer-quality-report.md`. The current report also verifies that the original integrated smoke suite remains 11/11 PASS.

## Tokyu / Keio / Odakyu source preparation

The private-core source registry classifies Keio as official GTFS (`TYPE_A`)
and Tokyu/Odakyu as official ODPT JSON (`TYPE_B`). Collect all three Challenge
2026 sources atomically with:

```bash
ODPT_CHALLENGE_KEY=... ./scripts/fetch-private-core.sh
```

The key is never persisted. Keio remains an unchanged source GTFS. Tokyu and
Odakyu are adapted into the common normalized schema with the shared parser:

```bash
pnpm --filter @tcache/jr-timetable-tools adapt:private-core -- \
  --operator tokyu \
  --raw-directory data/japan/tokyo/private-core/tokyu/latest/raw \
  --output-directory data/japan/tokyo/private-core/tokyu/latest \
  --source-edition challenge-2026-observed-key \
  --service-start-date YYYY-MM-DD \
  --service-end-date YYYY-MM-DD
```

Run the same command with `--operator odakyu`. The adapter emits coordinate
candidates, not approved mappings. A human/OSM review must change them to
`confirmed` before the common GTFS generator is allowed to build a feed. It
does not infer cross-line through-service merges.

The private-core smoke contract contains 32 required ODs: 20 operator-only,
six private↔JR, and six private↔Metro. These cases are not added to the
production quality gate until all three feeds have validator error 0 and the
reviewed station mappings have been measured in an OTP candidate graph.

## Keikyu / Keisei / Seibu / Tobu / Sotetsu source preparation

The private-outer registry classifies Keikyu and Seibu as official ODPT JSON
(`TYPE_B`), Tobu and Sotetsu as official GTFS (`TYPE_A`), and Keisei as
fail-closed (`TYPE_D`). Collect only the four available official sources with:

```bash
ODPT_CHALLENGE_KEY=... ./scripts/fetch-private-outer.sh
```

The key is never persisted. Keikyu and Seibu reuse the common normalized
adapter by passing `--operator keikyu` or `--operator seibu` to
`adapt:private-core`. Tobu and Sotetsu archives remain unchanged and are
checked by the official-GTFS source-contract inspector before graph staging.
No cross-operator through trip is synthesized.

Keisei is intentionally not collected: no current official train-level
machine source has been verified for the required general service. The
collector exits nonzero for `PRIVATE_OUTER_OPERATOR=keisei` or `all`, rather
than inserting an unofficial feed or inferring complete trips from station
pages.

The private-outer contract defines 35 airport/private/cross-feed ODs and a
prospective 12-feed config. It stays inactive until all five feeds have
validator error 0. Once a candidate exists, integrated smoke results include
per-query latency and the following command writes graph size, build/startup
time, memory, and latency p50/p95/max:

```bash
pnpm --filter @tcache/otp-quality-gate collect-performance -- \
  --build-root otp/data/japan/tokyo/builds/candidate
```

Current status and remaining blockers are recorded in
[reports/private-outer-integration-report.md](reports/private-outer-integration-report.md).

## Final 12-feed Tokyo rail production candidate

The final registry is `config/tokyo-rail-production-registry.json`. It fixes
the 12 feed IDs, minimum line coverage, input environment variables, and 16
critical station complexes. The final regression generator combines all prior
suites into 148 unique ODs:

```bash
pnpm --filter @tcache/otp-quality-gate assemble-regression
```

Each prepared feed must be represented in a source snapshot conforming to
`schemas/tokyo-rail-source-snapshot.schema.json`. The snapshot separates raw
source SHA from generated/pass-through GTFS SHA and records timetable edition,
GTFS version, parser structure, station count, parse coverage, validator
errors, and collection time. Normal refreshes that change bytes require a
review record tied to the previous source SHA.

Build and gate the complete candidate with:

```bash
TOKYO_RAIL_SOURCE_SNAPSHOT=/absolute/path/source-snapshot.json \
  ./scripts/build-and-approve-final-tokyo-rail.sh
```

The registry lists the `TOKYO_RAIL_*_GTFS` variable required for each feed.
The build fails before OTP if any of the 12 inputs is absent, its GTFS SHA does
not match the snapshot, the validator reports an error, or the regression date
is outside a feed's service window.

Baselines are explicit review actions and are never created by a normal build:

```bash
pnpm --filter @tcache/otp-quality-gate capture-source-baseline -- \
  --snapshot /absolute/path/source-snapshot.json \
  --reviewed-by REVIEWER --review-reference TICKET

pnpm --filter @tcache/otp-quality-gate capture-production-baseline -- \
  --build-root otp/data/japan/tokyo/builds/candidate \
  --reviewed-by REVIEWER --review-reference TICKET
```

The first clean 12-feed gate run generates coverage, linking, transfer, and
performance metrics but stops before promotion when the production baseline is
absent. A later PASS is the only path that atomically updates `builds/latest`.
The current status is documented in
[reports/tokyo-rail-production-integration-report.md](reports/tokyo-rail-production-integration-report.md)
and the generated line table is
[reports/tokyo-rail-coverage-report.md](reports/tokyo-rail-coverage-report.md).

## Linking / transfer production quality gate

The reviewed baseline is stored in
`baselines/tokyo-linking-transfer.json`; thresholds and per-feed budgets are in
`config/linking-transfer-quality-gate.json`. A normal build must not recapture
the baseline. Baseline replacement is an explicit review action:

```bash
pnpm --filter @tcache/otp-quality-gate capture-baseline -- \
  --build-root otp/data/japan/tokyo/builds/latest
```

Every gated build writes `quality/linking-quality.json`,
`quality/transfer-quality.json`, `quality/gate-result.json`,
`quality/regression-report.md`, and `quality/baseline-diff.md`. Metric cohort
definitions, hard failures, warnings, critical stations, and reproduction
commands are documented in [tools/quality/README.md](tools/quality/README.md).

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

The combined JR East Yamanote + Toei scope validates cross-feed routing, but cannot establish parity with Ekispert or NAVITIME. Adding OTP to a production policy would still require durable licensed coverage and refresh operations for the wider JR East, Tokyo Metro, and private railway networks.
