# Tokyo rail production-candidate integration report

Generated: 2026-09-27 (Asia/Tokyo)

## Result

**THE 12-FEED PRODUCTION PIPELINE AND QUALITY CONTRACT ARE IMPLEMENTED, BUT
THE FINAL GRAPH IS BLOCKED.** The approved runtime remains
`tokyo-jr-toei-c66d3caaea06ccb3`, containing three feeds. No source placeholder,
unofficial Keisei feed, synthetic performance value, or unreviewed baseline was
used to claim final success.

The current automatically generated coverage report records 3/12 feeds loaded,
11/11 legacy smoke routes passing, 9 required lines `PARTIAL`, and 33 required
lines `BLOCKED`. This is an honest readiness snapshot, not a production claim.

## Implemented final contract

- One production registry defines all 12 stable feed IDs, required lines,
  source type, adapter contract, local input environment variable, and current
  source readiness.
- Five existing regression suites are assembled deterministically into 148
  unique ODs. All 12 feeds and the central-JR, Metro, JR↔Metro, JR↔private,
  Metro↔private, private↔private, Toei, Haneda, Narita, and Yokohama groups are
  mandatory.
- Sixteen critical station complexes are present: Tokyo, Shinjuku, Shibuya,
  Ueno, Ikebukuro, Shinagawa, Yokohama, Otemachi, Asakusa, Kita-senju,
  Kichijoji, Nakano, Musashi-kosugi, Kawasaki, Nippori, and Haneda Airport.
- The final builder resolves exactly 12 local GTFS paths, checks every
  `gtfsSha256` against the source snapshot, runs MobilityData Validator, checks
  the service date, derives the build identity from content hashes, and stages
  immutable inputs before OTP build.
- Source freshness checks cover source SHA, GTFS SHA/version, observed edition,
  parser structure, station count, parse coverage, validator errors, and source
  age. Changed source bytes require an approval tied to the previous SHA.
- The final quality gate checks exact feed/OD counts, source-change status,
  line coverage, validator errors, critical stations, isolated/unlinked/pruned
  budgets, per-feed linked/transfer ratios, transfer regression, and graph/
  build/startup/query/memory baselines.
- Promotion still uses the atomic candidate approval guard. Any failure leaves
  `builds/latest` unchanged and restarts the previously approved runtime.
- Diagnostics now support stop totals/ratios, snap p50/p95/max, cross-feed
  complex count, and per-feed source/validator/load/linking/regression status.

## Source and baseline blockers

| Blocker                                                  | Effect                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Tokyo Metro and Challenge source credentials are absent  | Metro and most private feeds cannot be collected                            |
| Keisei train-level official machine source is unresolved | Registry and source-change gate remain fail-closed                          |
| No 12-feed source baseline exists                        | Source updates cannot be approved automatically                             |
| No validated 12-feed graph exists                        | Linking, transfer, performance, and production baselines cannot be measured |

Source and production baseline files are intentionally absent. They can only
be created with explicit reviewer identity and review reference after the real
artifacts and metrics exist.

## Final workflow

1. Collect/normalize/generate the missing official feeds and create a source
   snapshot conforming to `schemas/tokyo-rail-source-snapshot.schema.json`.
2. Review the 12 source artifacts and capture the source baseline explicitly.
3. Set the registry-listed `TOKYO_RAIL_*_GTFS` variables and run the final
   builder. It creates `builds/candidate` but never changes `latest`.
4. Run the final quality gate. On the first clean build it generates all
   metrics and stops because no production baseline exists.
5. Review that candidate, capture the production baseline explicitly, and
   rerun the gate. Only a complete PASS reaches candidate approval.

Until the blocked sources, 12 validator reports, 148 live OTP routes, all
critical complexes, and both reviewed baselines exist, the final success
criteria are intentionally reported as unmet.
