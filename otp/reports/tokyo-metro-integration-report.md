# Tokyo Metro integration report

Generated: 2026-09-27 (Asia/Tokyo)

## Status

**BLOCKED ON OFFICIAL FEED CREDENTIAL.** The four-feed integration pipeline,
source contract, immutable collector, station-complex review entries, 40 Metro
OD regressions, and quality-gate budgets are implemented. The official Tokyo
Metro GTFS endpoint returns HTTP 403 without an ODPT consumer key, and no
`TOKYO_METRO_ODPT_KEY` or `ODPT_CONSUMER_KEY` is present in this environment.
No unofficial timetable or synthetic feed has been substituted.

The current approved graph remains `tokyo-jr-toei-c66d3caaea06ccb3`; it was
not replaced by an unvalidated Metro candidate.

## Source decision

The selected source is Tokyo Metro's official GTFS:

`https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip`

ODPT developer registration is free, but the download requires the
`acl:consumerKey` query parameter. The key is accepted only from an environment
variable and is never written to request logs, metadata, manifests, or shell
output. Downloaded bytes are stored as an immutable SHA-256-addressed artifact.

Transitland independently records the same producer URL, Tokyo Metro as the
publisher, nine routes, 185 stops, and an active version. It is used only as
catalog evidence; the implementation does not reconstruct a feed from
Transitland or silently switch to a third-party timetable.

## Implemented controls

- Stable feed ID: `jp-tokyo-metro`.
- Exact route contract: `G`, `M`, `H`, `T`, `C`, `Y`, `Z`, `N`, `F`.
- Original GTFS archive is staged unchanged.
- `parent_station`, platforms, entrances, trips, and `block_id` are preserved.
- No synthetic through-service trip merge is allowed.
- Feed version, SHA-1/SHA-256, source URL, HTTP metadata, route inventory, and
  service window are recorded without the credential.
- MobilityData Validator error count must be zero before OTP graph build.
- Build identity includes the Metro feed hash and feed version.
- Metro linking receives a fail-closed provisional per-feed quality budget
  (zero isolated, unlinked, or pruned stops). Any relaxation requires measured
  diagnosis and review after the first graph; it is not pre-tuned to pass.
- Reviewed station-complex additions cover Shibuya, Shinjuku, Ikebukuro,
  Otemachi, Ginza, Ueno, and Kita-senju. Station codes resolve to exactly one
  source stop; names alone never activate a merge.

## Regression contract

The Metro suite contains 40 new cases:

| Group          | Cases | Requirement                                       |
| -------------- | ----: | ------------------------------------------------- |
| Metro internal |    20 | All nine route short names are exercised          |
| JR ↔ Metro     |    10 | Both stable feed IDs and a real transfer required |
| Toei ↔ Metro   |    10 | Both stable feed IDs and a real transfer required |

These are merged with the existing 11 integrated smoke cases at quality-gate
runtime, giving 51 required ODs. The pre-existing 20 transfer regressions also
remain mandatory.

## Remaining execution

After a credential is supplied:

```bash
cd otp
TOKYO_METRO_ODPT_KEY=... ./scripts/fetch-tokyo-metro.sh
OTP_PORT=28081 ./scripts/build-and-approve-integrated-tokyo.sh
```

Completion still requires recording the actual validator report, OTP graph
load, 51/51 routing result, station-complex walk result, linking metrics, and a
passing production quality gate. Thresholds must be adjusted only from those
measured results; they must not be relaxed simply to hide warnings.
