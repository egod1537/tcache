# Tokyo private-outer integration report

Generated: 2026-09-27 (Asia/Tokyo)

## Status

**FOUNDATION COMPLETE; FIVE-OPERATOR GRAPH INTEGRATION BLOCKED.** Keikyu,
Seibu, Tobu, and Sotetsu have verified official Challenge 2026 source
contracts but require `ODPT_CHALLENGE_KEY`. Keisei is deliberately `TYPE_D`:
no current official train-level machine-readable source was found for the Main
Line and general Narita Sky Access service. No unofficial feed or inferred
station-page reconstruction was substituted.

Credential-free probes of the registered Keikyu, Seibu, Tobu, and Sotetsu
endpoints returned HTTP 403 on 2026-09-27. This distinguishes the current
authentication block from an adapter, parser, or archive-validation failure.

The current approved graph remains `tokyo-jr-toei-c66d3caaea06ccb3`. The
prospective 12-feed config is inactive and cannot replace that graph until all
five feeds have MobilityData validator error 0 and the complete regression
suite passes.

## Source classification

| Operator | Feed ID            | Type   | Official source                        | Current state  |
| -------- | ------------------ | ------ | -------------------------------------- | -------------- |
| Keikyu   | `jp-tokyo-keikyu`  | TYPE_B | ODPT Railway/Station/StationTimetable  | BLOCKED_AUTH   |
| Keisei   | `jp-tokyo-keisei`  | TYPE_D | No verified train-level machine source | BLOCKED_SOURCE |
| Seibu    | `jp-tokyo-seibu`   | TYPE_B | ODPT Railway/Station/StationTimetable  | BLOCKED_AUTH   |
| Tobu     | `jp-tokyo-tobu`    | TYPE_A | Official Challenge GTFS                | BLOCKED_AUTH   |
| Sotetsu  | `jp-tokyo-sotetsu` | TYPE_A | Official Challenge GTFS                | BLOCKED_AUTH   |

The exact credential-free endpoints, target lines, scope, and license are in
`config/private-outer-source-registry.json`. The key is supplied only from the
environment and is never persisted in URLs, hashes, logs, or manifests.

Official source evidence:

- Keikyu catalog: <https://ckan.odpt.org/dataset/?organization=keikyu>
- Seibu catalog: <https://ckan.odpt.org/dataset/?organization=seibu>
- Tobu GTFS: <https://ckan.odpt.org/dataset/tobu_train>
- Sotetsu GTFS: <https://ckan.odpt.org/dataset/sotetsu_train>
- Keisei route information: <https://www.keisei.co.jp/keisei/tetudou/accessj/>
- Keisei Skyliner timetable: <https://new-www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/skyliner_timetable.php>

## Implemented behavior

- `scripts/fetch-private-outer.sh` atomically collects the four supported
  official sources with bounded retries, timeouts, explicit user agent, and
  immutable SHA-derived collection IDs. A failed request cannot promote a
  partial collection.
- Keikyu and Seibu reuse the common ODPT normalized adapter. Ambiguous trip
  identity, incomplete sequences, or fewer than two stops fail closed.
- Tobu and Sotetsu remain unchanged official GTFS archives. Their source
  contracts require the target routes before any graph staging.
- Keisei and `PRIVATE_OUTER_OPERATOR=all` return an explicit blocked status;
  paid limited express service is excluded until it can be modeled from an
  authoritative source.
- Stable feed IDs and a prospective 12-feed OTP build config are defined,
  without activating a production candidate.
- Reviewed station-complex candidates cover Haneda Airport, Nippori, Ueno,
  Yokohama, Ikebukuro, Asakusa, Kita-senju, and Musashi-kosugi. A synthetic
  Sotetsu member is not added at Musashi-kosugi.
- Every integrated smoke query records host-observed query latency. The
  performance collector writes graph size, build duration, startup duration,
  build/idle memory, and query latency p50/p95/max with optional baseline
  deltas.

## Regression contract

| Group                    | Cases |
| ------------------------ | ----: |
| Haneda/Narita airport    |     8 |
| Private operator only    |     6 |
| JR East ↔ private        |     6 |
| Tokyo Metro ↔ private    |     5 |
| Private ↔ private        |     5 |
| Yokohama-area cross-feed |     5 |
| Total                    |    35 |

The named minimums Shinagawa→Haneda, Haneda→Yokohama, and Ueno/Nippori→Narita
are explicit cases. Added to the preceding 83-case candidate contract, the
future quality gate requires 118/118 smoke routes. Per-feed linking and
performance budgets remain `MEASURE_AFTER_FIRST_BUILD`; no threshold was
invented before measurement.

## Remaining execution

1. Supply `ODPT_CHALLENGE_KEY` locally and run
   `scripts/fetch-private-outer.sh` for Keikyu, Seibu, Tobu, and Sotetsu.
2. Adapt Keikyu/Seibu, review all station mappings, generate their GTFS, and
   preserve official Tobu/Sotetsu GTFS unchanged.
3. Obtain a licensed official train-level Keisei source, or explicitly scope
   and approve a separate official-HTML parser project. Station pages alone
   are not treated as sufficient evidence.
4. Require MobilityData validator error 0 for every feed and verify service
   dates before staging a graph.
5. Build the 12-feed candidate, run the existing suites plus 35 outer-private
   cases, collect linking/transfer/performance metrics, and establish reviewed
   per-feed baselines.
6. Promote only if all critical stations, existing quality budgets, and all
   118 smoke cases pass.

Until these steps pass, the completion condition “five operators loaded,
regressions passing, and quality gate passing” is intentionally not reported
as achieved.
