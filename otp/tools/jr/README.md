# JR timetable collection foundation

This package defines the source-neutral normalized timetable model, the JR East collector/parser PoC, and the normalized-data-to-GTFS Schedule generator.

The intended pipeline is:

```text
collector -> immutable raw body + request manifest -> operator parser
          -> normalized timetable + validation -> common GTFS generator
          -> reproducible GTFS ZIP -> official MobilityData validation
```

`common/` owns artifact storage, deterministic IDs and dataset versions, the service-day time model, schema parsing, validation, and collector/parser contracts. `jr-east/` implements the official public Yamanote timetable source. `gtfs/` is operator-neutral: agency, route type, direction policy, and feed publisher data are injected through a profile, so another normalized JR operator can reuse the same generator. Machine-readable JSON Schemas live in `otp/schemas/jr/`.

## ID and time policy

- Persistent station and line IDs use stable normalized semantic keys. Upstream numeric URL keys remain only in `SourceReference` or station mappings.
- Trip IDs include operator, edition, line, direction, train number, origin, first departure, and variant.
- Times are structured as `{ dayOffset, hour, minute, second }`; for example `25:12:00` becomes `{ dayOffset: 1, hour: 1, minute: 12, second: 0 }`.
- Dataset identity hashes operator, timetable edition, sorted source hashes, and parser version. Collection time is deliberately excluded.
- Parsed files use their full canonical content hash, so metadata timestamps cannot collide with the stable logical dataset version.
- A mapping can become `confirmed` only with `reviewedAt`; name similarity may create a `candidate`, but never a confirmed mapping.

## Use boundary

This code and all collected data are limited to the authorized personal education/research Tokyo OTP PoC. Collected and derived JR data must remain local, must not be redistributed, and must not be used in a commercial service.

Run from the repository root:

```bash
pnpm --filter @tcache/jr-timetable-tools test
pnpm --filter @tcache/jr-timetable-tools typecheck
```

## Yamanote collector/parser PoC

The JR East implementation discovers the current observed edition and all four Yamanote sources from the official timetable root and Tokyo Station index. It keeps the opaque edition key (for example, `2610`) separate from an explicitly printed label (for example, `2026年10月号`); the numeric key is never interpreted on its own.

Start with the bounded sample. This performs sequential official-page requests, selects at most two outer-loop weekday trips, fetches one linked public train-detail page, and writes a validation report:

```bash
pnpm --filter @tcache/jr-timetable-tools collect:yamanote -- \
  --mode sample \
  --direction outer \
  --service weekday \
  --max-trips 2 \
  --max-details 1
```

Only after a sample produces `validationStatus: PASS`, a `.sample-passed.json` marker permits full mode:

```bash
pnpm --filter @tcache/jr-timetable-tools collect:yamanote -- \
  --mode full-yamanote \
  --direction both \
  --service both \
  --max-details 4
```

Defaults are a 750 ms request delay, 15 second timeout, three bounded attempts, and concurrency 1. `--delay-ms`, `--timeout-ms`, `--max-attempts`, `--hour-from`, `--hour-to`, `--output-root`, and `--user-agent` are configurable. The collector refuses non-HTTPS or non-`timetables.jreast.co.jp` sources.

Each dataset is written to `otp/data/japan/tokyo/jr-east/yamanote/<dataset-version>/` with content-addressed `raw/`, per-request manifests, split normalized JSON, `manifest.json`, `request-log.json`, `conflicts.json`, and `validation-report.json`. Matrix/detail conflicts are reported and never silently corrected. Missing reviewed OSM station mappings are warnings; schema, reference, time-order, or ambiguity errors make validation fail.

## GTFS Schedule generator

The committed `yamanote-osm-reviewed.json` mapping contains 30 exact-name/JY-code matches to OSM `stop_position` members of Yamanote relation 1972920. Every entry is explicitly `confirmed`; the generator never invents a coordinate and fails if a used station is missing, unreviewed, or lacks a coordinate pair.

Build and validate an existing normalized dataset:

```bash
pnpm --filter @tcache/jr-timetable-tools build:gtfs:yamanote -- \
  --dataset-root /absolute/path/to/otp/data/japan/tokyo/jr-east/yamanote/<dataset-version>
```

The default validation step runs the official MobilityData GTFS Validator Docker image pinned to `8.0.1`. Use `--skip-validator true` only for local generator development. Outputs are `gtfs/*.txt`, `gtfs/jr-east-yamanote.gtfs.zip`, `gtfs/manifest.json`, and `validator/{report.html,report.json}`. A validator error makes the command fail.

The Yamanote direction policy is feed-local and explicit: `direction_id=0` means outer loop (`外回り`, clockwise), and `direction_id=1` means inner loop (`内回り`, counter-clockwise). GTFS does not define a universal meaning for these two values.

Normalized `{ dayOffset, hour, minute, second }` values become GTFS times such as `24:01:00`. Missing arrival or departure at a timed stop is filled from the other event at that same stop; no travel time is inferred. The generator validates time monotonicity before and after conversion. Unresolved holiday/temporary-service conditions remain recorded in the manifest and are not invented as `calendar_dates.txt` exceptions.

CSV files use stable row/column ordering. The ZIP uses a fixed timestamp, and the manifest records both the binary ZIP SHA-256 and a canonical hash of the eight GTFS file contents. Run the fixture and official-validator integration tests with:

```bash
pnpm --filter @tcache/jr-timetable-tools test
pnpm --filter @tcache/jr-timetable-tools test:integration:gtfs
```
