# JR East Tokyo rail coverage expansion report

Generated: 2026-09-27 (Asia/Tokyo)

Scope: personal education/research only. JR-derived artifacts must not be redistributed or used commercially.

## Outcome

The minimum target is complete. Yamanote, Chuo Rapid, Chuo-Sobu Local, and
Keihin-Tohoku/Negishi are collected for both directions and weekday/holiday
service, normalized, converted to GTFS, loaded into OTP, and regression-tested.

| Line                       | Dataset version                 | Stations | Trips | Normalized validation | GTFS validator errors |
| -------------------------- | ------------------------------- | -------: | ----: | --------------------- | --------------------: |
| Yamanote (JY)              | `jr-east:2610:96dec87ea60caa40` |       30 | 1,037 | PASS                  |                     0 |
| Chuo Rapid (JC)            | `jr-east:2610:59f37ba3a5819181` |       24 | 1,099 | PASS                  |                     0 |
| Chuo-Sobu Local (JB)       | `jr-east:2610:86e598dd01e44c0c` |       39 | 1,065 | PASS                  |                     0 |
| Keihin-Tohoku/Negishi (JK) | `jr-east:2610:6167a6a80923ef5a` |       47 | 1,263 | PASS                  |                     0 |

The deterministic merged dataset is
`jr-east:2610:1a8ce8e24584421d`: 4 routes, 110 unique stations, 4,464 trips,
and 120,443 GTFS stop-time rows. Its canonical GTFS content hash is
`5da86073d7c49529d4682c4121fe31e7992b735ef4e01fe72c0f4b8b2bb8177a`.
MobilityData GTFS Validator 8.0.1 reports zero errors for every per-line feed
and the combined feed.

## Parser and mapping behavior

- The former Yamanote-only collector is registry-driven and validates the
  expected line, direction, service class, and matrix heading.
- Local/Rapid/Special Rapid labels are retained as train types. `レ`, `通過`,
  and `↓` are normalized as pass-through points and are not emitted as GTFS
  boarding stops.
- Matrix continuation markers (`||`, `┐`) are not guessed into through trips;
  their columns are reported as `AMBIGUOUS_TRIP` until detail evidence can
  reconcile them.
- Duplicate train numbers remain distinct through deterministic trip variants.
- Raw HTML and detail pages remain immutable and source hashes, observed
  edition key `2610`, parser version, and source URL are retained in manifests.
- All 110 station mappings require an exact official Japanese station name and
  JR route-code match. Low-confidence fuzzy candidates are never auto-approved.

For OTP linking, 68 reviewed high-confidence station-entrance overrides are
applied to a derived GTFS; the immutable generated GTFS remains unchanged.
Another 27 low-confidence candidates remain inactive in the override artifact.

## OSM and OTP integration

The OSM input is a reproducible corridor polygon over the prior Tokyo/Toei
coverage plus the JR east, north, and south extensions. It was extracted from
the local Geofabrik Kanto snapshot with `osmium-tool 1.19.1`,
`complete_ways`, and explicit header bounds. The PBF SHA-256 is
`198054ffe2a2680449f2e35159a97c668b09a16f91f0836d8e8636d1ed90b4d7`.

Approved OTP build: `tokyo-jr-toei-c66d3caaea06ccb3`.

| Metric                       | Previous approved baseline | Expanded build |
| ---------------------------- | -------------------------: | -------------: |
| Total stops                  |                      3,869 |          3,949 |
| JR linked stops              |                         30 |            110 |
| Isolated stops               |                          0 |              0 |
| Pruned stop islands          |                         35 |             35 |
| OSM snap distance p95        |                      6.9 m |          6.7 m |
| Cross-feed station complexes |                         16 |             17 |
| Existing integrated smoke    |                      11/11 |          11/11 |
| Transfer regression          |                      20/20 |          20/20 |
| Station-complex walks        |                      28/28 |          29/29 |

The quality gate passed and promoted the candidate. Raw unlinked-transfer
events increased from 132 to 162, so the gate records a warning rather than
hiding it. The 32 JR events are all `NO_NEARBY_TRANSFER_PEER` P3 observations
at standalone stations; JR has no isolated or pruned stop. The new Shin-koiwa
JR/bus complex has a verified walking path and no synthetic transfer rule.

## Route regression

The approved graph passes 30/30 route-specific weekday ODs: 10 each for JC,
JB, and JK. A case passes only when the itinerary contains the requested route
short name, so another JR route cannot satisfy it accidentally. Existing
Yamanote, Toei-only, JR-Toei transfer, and bus smoke cases remain 11/11 PASS.

The expansion result is stored under the approved build's
`smoke-tests/20260927T110950Z/` directory. The build manifest retains the JR
dataset version, input hashes, OTP version, validator results, OSM lineage, and
quality-gate reports.

## Deferred lines and known limitations

Sobu Rapid, Yokosuka, Saikyo, Shonan-Shinjuku, and the urban Joban segment stay
in the source registry as planned work. Chuo-Sobu matrix columns that encode
unresolved through-service continuation are intentionally excluded rather than
fabricated. This preserves source fidelity but means this release does not yet
claim complete through-running coverage outside the four activated route
profiles.
