# Tokyo PoC verification result

## Integrated JR East + Toei verification (2026-09-27)

Build `tokyo-jr-toei-201318406920c285` combined the locally generated Yamanote feed with Toei Rail, Toei Bus, and the BBBike Tokyo OSM extract. All three feeds passed MobilityData GTFS Validator 8.0.1 with zero errors. The graph built in 92 seconds, is 132,028,323 bytes, and loaded in six seconds; observed idle container memory was 1.287 GiB.

The automated smoke suite used 2026-09-29 10:00 JST and passed 11/11 routes: three JR-only, three Toei-only, three cross-feed JR↔Toei transfers, and two routes containing Toei Bus. Every selected itinerary had a positive duration, ordered legs and stop sequences, at least one transit leg, and identifiable agency/feed IDs. Cross-feed cases contained both stable feed IDs and a real transfer.

| Preflight feed       | Validator errors | Warnings |
| -------------------- | ---------------: | -------: |
| `jp-tokyo-jr-east`   |                0 |   64,859 |
| `jp-tokyo-toei-rail` |                0 |        4 |
| `jp-tokyo-toei-bus`  |                0 |      300 |

Warnings are retained in the versioned validator reports and are not silently treated as errors. The JR warning volume consists mainly of validator notices about non-ASCII characters in Japanese timetable text, followed by mixed-case recommendations; it remains available for review rather than being suppressed. The graph import reported 421 isolated stops, 545 stops not linked for transfers, and 60 pruned stop islands; these counts are stored in the build manifest and remain explicit OSM-linking/coverage risks.

Machine-readable evidence is under `data/japan/tokyo/builds/latest/`: `manifests/build-manifest.json`, `manifests/preflight.json`, `validator/`, `graph/build-report/`, and `smoke-tests/latest/summary.json`. Official journey-planner results were not copied as truth; a reference comparison remains a manual qualitative check.

Verified on 2026-09-24 using an Apple Silicon host with 16 GiB RAM and an 8 GiB Docker VM. The server was bound to port 28080 because port 8080 was already occupied; the reproducible default remains 8080.

## Versions and inputs

| Item         | Verified value                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| OTP          | 2.10.0, commit `521cd5d8acaae628878f43bf5946f4942c118548`                                                                       |
| Image digest | `sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933`                                                       |
| Java         | 25.0.4 from the OTP image                                                                                                       |
| OSM          | BBBike Tokyo extract, HTTP last-modified 2026-09-19, SHA-256 `0fac15590648df3e39760d5337444353aea6ef0babf9b8c16a711d64dca01ea2` |
| Toei Train   | feed version `20260921`, service 2026-03-14 through 2027-03-12                                                                  |
| Toei Bus     | feed version `20260924_030759`, service 2026-09-24 through 2029-09-23                                                           |
| Graph build  | 2026-09-24, `Asia/Tokyo`                                                                                                        |

## Build and runtime

| Metric                                    |                        Result |
| ----------------------------------------- | ----------------------------: |
| OTP graph-building phase                  |                        55.8 s |
| End-to-end warm-image build script        |                          63 s |
| Approximate peak container memory         |                     3,213 MiB |
| `graph.obj` size                          | 130,918,042 bytes (124.9 MiB) |
| Graph vertices / edges                    |           555,983 / 1,519,248 |
| Transit stops / routes / trips / patterns |    3,839 / 156 / 58,442 / 805 |
| Cold container startup to health-ready    |                           7 s |
| Observed idle container memory            |                     1.357 GiB |

The HTML import report was generated successfully. Material warnings include 421 isolated stops, 545 stops not linked for transfers, and 47 pruned stop islands. These are retained as evidence of data/street-link quality work required before production use.

## Route results

Departure: 2026-09-25 10:00 JST. Every route returned three itineraries and the first itinerary included both walking and transit legs.

| Route                       | First itinerary duration | Walking | Transfers | First itinerary modes                | p50 (5 requests) |
| --------------------------- | -----------------------: | ------: | --------: | ------------------------------------ | ---------------: |
| Tokyo Station → Shibuya     |                  3,666 s | 1,380 s |         1 | WALK → SUBWAY → WALK → BUS → WALK    |           101 ms |
| Tokyo Station → Shinjuku    |                  2,732 s | 1,746 s |         1 | WALK → SUBWAY → WALK → SUBWAY → WALK |            91 ms |
| Shinjuku → Asakusa          |                  3,231 s | 1,477 s |         1 | WALK → SUBWAY → WALK → SUBWAY → WALK |           106 ms |
| Ueno → Shibuya              |                  3,921 s | 1,387 s |         1 | WALK → SUBWAY → WALK → BUS → WALK    |           131 ms |
| Tokyo Station → Tokyo Tower |                  1,811 s | 1,511 s |         0 | WALK → SUBWAY → WALK                 |            73 ms |

Overall p50 across the dedicated 25-request warm benchmark was 105 ms. The first cold GraphQL query was 1,159 ms, showing that startup/JIT warm-up matters for latency interpretation.

## Failure results

- Osaka coordinates against the Tokyo graph: `OUTSIDE_BOUNDS`, zero itineraries.
- A 2035 departure: `OUTSIDE_SERVICE_PERIOD`, zero itineraries.
- An in-bounds 02:00 departure with no service in the two-hour window: `NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW`, zero itineraries.
- Missing required Toei Bus feed: build wrapper exits before invoking OTP.
- Stopped OTP container: GraphQL connection fails at the network boundary.
- Build/import quality issues: visible in the generated HTML report and `build.log`.

## Decision

OTP can build and serve real Tokyo multimodal itineraries with acceptable PoC resource use and warm latency. The pipeline itself is viable for an experimental tcache provider.

It is not yet a viable replacement for Ekispert/NAVITIME. The integrated local graph now proves Yamanote + Toei cross-feed routing, but it still excludes Tokyo Metro, other JR East lines, and private railways. Keep the OTP provider experimental and disabled by default until a durable, licensed feed-refresh plan covers the operators required by the product.
