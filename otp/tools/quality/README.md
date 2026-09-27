# Tokyo OTP linking / transfer quality gate

This gate prevents a newly built Tokyo graph from replacing the approved
`latest` graph until its GTFS, stop-to-OSM linking, required routes, and reviewed
transfers pass reproducible checks. It does not change production provider
selection policy.

## Metrics

The stop cohort is every `location_type=0` GTFS stop referenced by at least one
`stop_times` record. A linked stop has neither an OTP `IsolatedStop` nor
`PrunedStopIsland` warning. `StopNotLinkedForTransfers` is tracked separately;
its ratio uses the same stop cohort. OSM snapping p50/p95/max is measured from
every cohort stop to the nearest walkable OSM segment, not only warning stops.

Counts and snapping budgets are also evaluated for `jp-tokyo-jr-east`,
`jp-tokyo-toei-rail`, and `jp-tokyo-toei-bus`. Critical station members must
exist in the operational cohort and have no isolated, unlinked-transfer, or
pruned warning.

## Gate behavior

Hard failures include validator errors, a required OD or transfer regression
failure, a changed regression case count, a missing critical station, a P0
isolated/pruned issue, missing snap measurements, or an overall/per-feed budget
breach. Baseline regressions in unlinked ratio, snapping p95, or P2/P3 warning
counts are reported as warnings while still subject to the hard ceilings.

Run the full candidate workflow from `otp/`:

```bash
OTP_PORT=18082 ./scripts/quality-gate-integrated-tokyo.sh
```

Or reproduce only collection and evaluation while all prerequisite reports
already exist:

```bash
pnpm --filter @tcache/otp-quality-gate collect -- \
  --build-root otp/data/japan/tokyo/builds/candidate
pnpm --filter @tcache/otp-quality-gate gate -- \
  --build-root otp/data/japan/tokyo/builds/candidate
```

The full gate also writes `quality/performance-metrics.json` from the graph
build summary, runtime summary, and measured latency of every smoke query. Run
the collector independently with:

```bash
pnpm --filter @tcache/otp-quality-gate collect-performance -- \
  --build-root otp/data/japan/tokyo/builds/candidate
```

`approve-integrated-candidate.sh` independently verifies `status=PASS` and
`candidateApprovalAllowed=true` before atomically changing the `latest`
symlink. Failed candidates remain versioned; their reports explain the failure.

The repository baseline is deliberately immutable during normal builds. Use
`capture-baseline` only after human review of an intentionally changed dataset
or policy.

## Final Tokyo rail gate

`assemble-regression` builds the deterministic 148-case suite from the five
existing source suites. `check-sources` compares a 12-feed source snapshot to
an explicitly approved baseline, and `coverage` produces the operator/line
table plus per-feed diagnostics. `production-gate` requires all lines to be
verified, all 148 ODs to pass, critical-station failures and validator errors
to be zero, linking/transfer budgets to remain inside baseline, and performance
regressions to stay within policy.

`capture-source-baseline` and `capture-production-baseline` both require
`--reviewed-by` and `--review-reference`. They use exclusive creation by
default; replacing a baseline requires the explicit `--replace true` option.
The final shell workflow is `scripts/quality-gate-final-tokyo-rail.sh`.

Scope: personal education/research only. Generated JR East data is not for
external distribution or commercial use.
