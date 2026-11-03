# KR Route Provider Validation

Goal: choose a stable provider for Korean WALKING and DRIVING routes in tcache, based on evidence.
Source IDs `[S*]` are defined in `candidate-source-matrix.md`, and `[P*]` in `policy-snapshot.md`. All sources were accessed on 2026-10-05.

| Work | Scope | Status |
|---|---|---|
| KR-W1 | Discovery & qualification: code audit, official sources, policy, W2 design | Done 2026-10-05 |
| KR-W2 | Live benchmark: real calls, quality, latency | PENDING (credentials required) |

## Artifact manifest

| Artifact | File | State |
|---|---|---|
| candidate-source-matrix | `candidate-source-matrix.md` | W1 created |
| policy-snapshot | `policy-snapshot.md` | W1 created |
| W2 test matrix | `w2-test-matrix.md` | W1 created (design only) |
| live-benchmark | `live-benchmark.md` | PENDING (W2) |
| raw/normalized evidence | `raw/`, `normalized/` | PENDING (W2) |
| comparison | `comparison.md` | PENDING (W2) |
| final-decision | `final-decision.md` | PENDING (after W2) |
| human-validation | `human-validation.md` | PENDING (W2) |

## Current architecture (main @ 0554644)

- **Request contract**: `route/server/types/route.ts`.
  - `NormalizedRouteRequest` has origin, destination, intermediates (+ `waypoints` alias), `travelMode` (DRIVING/WALKING/BICYCLING/TRANSIT), optional `departureTime`, `computeAlternativeRoutes`, `countryCode` (ISO-2, uppercased), `routingPreference` (DRIVING only), and free-form `options`.
  - A location may carry `coordinates`, `name`, `address`, or `externalIds` (google/kakao/navitime/ekispert).
- **Provider interface**: `route/server/providers/provider.ts`.
  - `RouteProvider.getRoute()` returns `{ provider, result: unknown, debug }`. Each provider defines its own `result` shape; there is no shared normalized route type.
  - Capabilities: `countries`, `modes`, `supportsWaypoints`, `maxLocations`, `requiresCoordinates`, `supportsDepartureTime`, `requiresDepartureTime`, plus per-mode overrides.
  - `ROUTE_PROVIDER_NAMES` is a closed union, so a new provider needs a code change.
- **Resolver**: `route/server/resolver/provider-policy.ts` and `provider-resolver.ts`.
  - Selection order: request override → global force → country+mode → country default → mode default → global default.
  - Built-in KR policy: DRIVING→`kakao-mobility`, WALKING/BICYCLING/TRANSIT→`kakao-maps`. Can be overridden with `ROUTE_PROVIDER_POLICY_JSON`.
  - Exactly one provider per country+mode. No automatic fallback on provider error (README §195).
- **Cache**: `route/server/cache/key.ts`.
  - Key format: `route:v4:<provider>:<mode>:<country>:<hash>`. Provider-scoped, with a 10-minute time bucket.
  - TTL comes from `ROUTE_CACHE_TTL_SECONDS` (default 3600).
- **Kakao adapters**: `route/server/providers/kakao/*`.
  - Coordinates are required.
  - Both adapters cap at 5 waypoints (`maxLocations: 7`).
  - Results are parsed into a Kakao-local normalized shape: `KakaoNormalizedRoute` with distance, duration, path, bounds, legs, and steps.

## Tcache fit (qualified candidates)

| Question | Kakao Maps WALK | Kakao Mobility DRIVE | TMAP WALK | TMAP DRIVE |
|---|---|---|---|---|
| A. Express origin/dest/mode | Yes | Yes | Yes | Yes |
| B. Coordinates mandatory | Yes (already `requiresCoordinates`) | Yes | Yes | Yes |
| C. Waypoint limit fits capabilities | ≤5 → `maxLocations: 7` | ≤5 → 7 | ≤5 → 7 | ≤5 → 7 |
| D. Map distance/duration/geometry | Yes (already done) | Yes. Toll, traffic, and taxi fare are currently dropped | Yes (GeoJSON LineString) | Yes. `totalFare` and `traffic` need a home |
| E. Common interface change needed | No | Toll/traffic: optional | No | Toll/traffic: optional |
| F. If yes: generic or pollution | — | **Generic** (e.g. optional `tollAmount`/`currency` on route) | — | Generic (same field) |
| G. One provider for both modes? | Kakao needs 2 adapters and 2 env names, but **one key type** (Kakao Developers REST key, [S3]) | ↔ | TMAP: one provider and one key for both | ↔ |
| H. countryCode=KR + mode resolver | Yes (already) | Yes | Needs `'tmap'` added to `ROUTE_PROVIDER_NAMES` (generic) | same |

Extra TMAP notes:
- TMAP pedestrian requires `startName` and `endName` (Mandatory=Y, [S10]). The adapter must default them (e.g. 출발/도착) when `location.name` is missing.
- TMAP requests are POST form-encoded with an `appKey` header.

## Existing code vs official reality — mismatches

| # | Where | Mismatch | Severity |
|---|---|---|---|
| M1 | `kakao/mobility.ts` capabilities | `supportsDepartureTime` is not set, so a DRIVING `departureTime` is accepted and silently ignored. `/v1/directions` is real-time only, and future time needs `/v1/future/directions` ([S9]). | Medium |
| M2 | `kakao/mapper.ts` `toKakaoMobilityRequest` | `priority` is hardcoded to `RECOMMEND`. `routingPreference` and `avoid`/`car_hipass` are not mapped. | Low |
| M3 | `kakao/parser.ts` `parseMobilityRoute` | Drops the officially documented `summary.fare.toll`, `fare.taxi`, and `roads[].traffic_state`. The route has no toll field. | Medium (KR-R7) |
| M4 | `kakao/mapper.ts` `toKakaoMapsRequest` | Does not send the documented `route_mode` (BROAD_FIRST/SHORTEST/ACCESSIBLE). | Low |
| M5 | `kakao/errors.ts` | Documented walk statuses `TOO_MANY_SEARCH_LINK` and `ROUTE_RESULT_NOT_FOUND` are not classified (both fall to UNAVAILABLE). | Low |
| M6 | Cache policy vs Kakao terms | tcache caches Kakao results (TTL 3600). Kakao operating policy and staff replies restrict caching or storage ([P1], [P3], [P4]). | **High (production blocker)** |
| M7 | Commercial use | Kakao Mobility requires a partnership contract for commercial use ([P6]). No such gate exists in config or docs. | **High (production blocker)** |
| M8 | `google/client.ts` capabilities | No `countries` restriction. An env-json policy or override can send KR WALK/DRIVE to Google, which does not cover KR ([S15]). | Low |
| M9 | Resolver | One provider per country+mode and no fallback. KR-R21 regional fallback cannot be expressed without a generic extension (e.g. an ordered list per country+mode). | Medium (design) |
| M10 | `.env.example` | `KAKAO_MOBILITY_API_KEY` reads as a separate credential, but Kakao Mobility uses the Kakao Developers app REST API key ([S3]). It may hold the same value as `KAKAO_REST_API_KEY` (**inferred**). | Info |
| M11 | Shared result type | `RouteProviderResult.result` is `unknown`, and each provider has its own "normalized" type. Cross-provider comparison in W2 needs a comparison-side normalizer, not a production change. | Info |

No mismatch on endpoint existence: all four Kakao endpoints in the code are currently officially documented.

## Credential inventory (values never printed)

| Name | `.env.example` | Local env / `.env` | Notes |
|---|---|---|---|
| `KAKAO_REST_API_KEY` | present (empty) | **MISSING** (no `.env`; shell unset) | Kakao Developers app → REST API key. The **Kakao Map API must be activated** on the app. Free quota applies to the first activated app only. Signup free. Human action. |
| `KAKAO_MOBILITY_API_KEY` | present (empty) | **MISSING** | Same Kakao Developers REST key ([S3]). Non-commercial use within the free quota needs no partnership ([P7]). Human action. |
| `GOOGLE_MAPS_API_KEY` | present (empty) | **MISSING** | Not needed for KR WALK/DRIVE (eliminated) |
| `TMAP_APP_KEY` (proposed name) | **absent** | **MISSING** | Required. Obtain via openapi.sk.com / tmapapi.tmapmobility.com signup → project → TMAP API Free plan (1,000/day for route APIs). Free signup is possible. Human action. |
| Naver `x-ncp-apigw-api-key-id`/`-key` | absent | MISSING | Not required (eliminated by policy) |

## Requirement ledger

| ID | Status | Note |
|---|---|---|
| KR-R1 candidate survey | VERIFIED | Kakao Maps, Kakao Mobility, TMAP, Naver, Google, self-hosted OSM |
| KR-R2 official API & scope | VERIFIED | candidate-source-matrix §1–2 |
| KR-R3 real API calls | PENDING | W2 (credentials) |
| KR-R4 walking quality | PENDING | W2 |
| KR-R5 driving quality | PENDING | W2 |
| KR-R6 geometry | PARTIAL | Format verified from docs. Live check in W2 |
| KR-R7 ETA/distance/cost/toll/segment | PARTIAL | Documented fields verified. Live values in W2. M3 found |
| KR-R8 regional coverage | PENDING | Matrix designed (w2-test-matrix) |
| KR-R9 each region walk+drive | PENDING | Matrix designed |
| KR-R10 route naturalness | PENDING | W2 human-validation |
| KR-R11 latency/timeout/stability | PENDING | W2, 5 reps/row |
| KR-R12 price/quota/rate limit | PARTIAL | Price and quota verified. Per-second rate limits UNKNOWN |
| KR-R13 commercial/cache/storage | PARTIAL | Kakao and Naver restrictions found. TMAP 24h. Kakao needs written confirmation |
| KR-R14 map SDK dependency | PARTIAL | Mostly UNKNOWN in official text |
| KR-R15 attribution/logo | PARTIAL | Naver may require logo. Kakao and TMAP UNKNOWN |
| KR-R16 official source + date + URL | VERIFIED | All claims carry a source ID and the 2026-10-05 access date |
| KR-R17 request model compatibility | VERIFIED | Tcache fit A–C, H |
| KR-R18 normalized conversion | PARTIAL | Desk-mapped. Prove in W2 |
| KR-R19 field pollution | VERIFIED | Toll and traffic are generic extensions. No pollution required |
| KR-R20 same vs separate provider | PARTIAL | TMAP can cover both. Kakao needs two endpoints with one key type. Decide after W2 |
| KR-R21 regional fallback | PARTIAL | Not expressible today (M9). Candidates: Kakao↔TMAP |
| KR-R22 minimal prototype/test adapter | PENDING | W2 benchmark script only. No production adapter |
| KR-R23 comparison artifact | PENDING | W2 |
| KR-R24 final recommendation | PENDING | After W2 |
