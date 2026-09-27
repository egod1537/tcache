# OTP linking diagnostics and reviewed overrides

This tool decomposes OTP `IsolatedStop`, `StopNotLinkedForTransfers`, and `PrunedStopIsland` reports without changing the graph or any linking threshold.

Run from the repository root:

```bash
pnpm --filter @tcache/otp-linking-tools diagnose
```

To inspect another versioned build:

```bash
pnpm --filter @tcache/otp-linking-tools diagnose \
  --build-root otp/data/japan/tokyo/builds/<build-id>
```

The tool reads the exact GTFS, OSM PBF, build configuration, and OTP GeoJSON reports from the selected build. It streams the PBF and records nearest pedestrian way, platform/railway object, stop position, station object, and signed extract-boundary distance for every affected stop.

Output defaults to `<build-root>/diagnostics/linking/`:

- `otp-linking-diagnosis.md`
- `otp-linking-issues.json`
- `otp-linking-issues.geojson`
- `otp-linking-top-offenders.md`

OTP warning events and stop references are intentionally separate. A single pruned-island event may contain several stops. The GeoJSON uses `layer`, `feedId`, `mode`, `rootCause`, and `priority` properties for map filtering.

Root-cause decisions are diagnostic heuristics backed by recorded distances; they do not assert edits to OSM. `TOKYO_23_WARDS_APPROX` is a coarse envelope, while PBF coverage and boundary distances come directly from the PBF header. A wider PBF comparison requires a separate graph build rather than an assumed warning reduction.

## Improvement workflow

`prepare-overrides.mjs` combines a diagnosis with the explicit review list in `otp/config/stop-osm-override-review.json`. `apply-overrides.mjs` creates deterministic derived GTFS ZIPs and enforces these safeguards:

- the immutable source ZIP must match its declared SHA-256;
- active entries must be reviewed and high confidence;
- every active entry must include a reason, source evidence, timestamp, and OSM element;
- inactive low-confidence candidates remain review evidence and are never applied.

`smoke-overrides.mjs` verifies boarding at the exact scoped GTFS stop ID. `report-improvement.mjs` produces `linking-improvement-report.md`, `before-after-metrics.json`, and `mapping-review.csv`. These tools never change global OTP linking or island-pruning thresholds.

Scope remains personal education/research. JR-derived artifacts remain local and must not be redistributed or used commercially.
