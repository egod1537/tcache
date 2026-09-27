# Tokyo private-core integration report

Generated: 2026-09-27 (Asia/Tokyo)

## Status

**BLOCKED ON CHALLENGE 2026 CREDENTIAL AND SOURCE REVIEW.** Tokyu, Keio, and
Odakyu official source contracts, immutable collection, adapters, normalized
conversion, station-complex candidates, and 32 routing regressions are
implemented. No `ODPT_CHALLENGE_KEY` is present in this environment, so no
official source bytes were downloaded and no substitute feed was used.
Credential-free probes of all three official source families returned HTTP
403, confirming that the block is authentication rather than parser failure.

The current approved graph remains `tokyo-jr-toei-c66d3caaea06ccb3`. It was
not replaced by an unvalidated private-railway candidate. Tokyo Metro is also
still awaiting its separate official ODPT credential, so private↔Metro graph
regressions cannot yet run.

## Source classification

| Operator | Type   | Official source                       | Current state |
| -------- | ------ | ------------------------------------- | ------------- |
| Tokyu    | TYPE_B | ODPT Railway/Station/StationTimetable | BLOCKED_AUTH  |
| Keio     | TYPE_A | Official Challenge 2026 GTFS          | BLOCKED_AUTH  |
| Odakyu   | TYPE_B | ODPT Railway/Station/StationTimetable | BLOCKED_AUTH  |

The source registry records credential-free endpoint URLs and the Challenge
Limited License. Credentials are accepted only from `ODPT_CHALLENGE_KEY` and
are excluded from artifacts, hashes, logs, and manifests.

## Implemented behavior

- Atomic collection: a failed request does not promote a partial collection.
- Immutable collection identity derived from all source SHA-256 values.
- Keio GTFS pass-through contract verifies the Keio, Inokashira, Takao, and
  Sagamihara target lines while preserving hierarchy and source trips.
- Tokyu/Odakyu adapter reconstructs trips using official station timetable
  train identity, railway station order, calendar, and direction evidence.
- Ambiguous station sequences and trips with fewer than two stops fail closed.
- Midnight rollover is preserved as service-day offsets and becomes `24:xx`
  in the common GTFS generator.
- Official coordinates remain `candidate`; they cannot enter GTFS until an
  explicit OSM/manual review marks the mapping `confirmed`.
- No through-service is manufactured across line/operator boundaries.
- Core complexes cover Shibuya, Shinjuku, Kichijoji, Shimokitazawa,
  Jiyugaoka, Meidaimae, and Machida.
- A seven-feed OTP build config and fail-closed quality-gate overlay are ready;
  private per-feed budgets remain deliberately unset until measured.

## Regression contract

| Group                         | Cases |
| ----------------------------- | ----: |
| Tokyu/Keio/Odakyu internal    |    20 |
| Private railway ↔ JR East     |     6 |
| Private railway ↔ Tokyo Metro |     6 |
| Total                         |    32 |

The named minimum cases Shibuya↔Yokohama, Shinjuku↔Kichijoji,
Shinjuku↔Machida, and Shibuya↔Jiyugaoka are included.

## Remaining execution

1. Supply `ODPT_CHALLENGE_KEY` locally and run `scripts/fetch-private-core.sh`.
2. Record the explicitly published service window/edition and adapt Tokyu and
   Odakyu to normalized datasets.
3. Review OSM station/entrance mappings; do not auto-confirm by name.
4. Generate Tokyu/Odakyu GTFS with the common generator and retain official
   Keio GTFS unchanged.
5. Run MobilityData Validator for all three feeds and require error count 0.
6. Add the three validated feeds to a candidate OTP graph, then run all
   existing regressions plus the 32 private-core ODs.
7. Measure linking budgets before changing the production gate. Promote only
   if critical stations and the existing baseline remain clean.

Until those steps pass, the completion condition “three operators loaded and
regressions passing” is intentionally not reported as achieved.
