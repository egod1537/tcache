# KR Route Provider — Candidate & Source Matrix (KR-W1)

- Work: KR-W1 Discovery & Qualification
- Accessed: 2026-10-05 (all URLs below)
- Base commit: `0554644` (main == `feat/kr-route-provider-validation`)
- Rule: capability claims come only from official docs. A DevTalk reply is listed only when Kakao staff wrote it, and is marked as such. "inferred" means the claim is not written word for word in the source.

## 1. Existing code endpoints vs official status

| tcache provider | Endpoint in code (`route/server/providers/kakao/mapper.ts`) | Mode in code | Official status | Evidence |
|---|---|---|---|---|
| `kakao-mobility` | `https://apis-navi.kakaomobility.com/v1/directions` | DRIVING | **OFFICIALLY_DOCUMENTED_PUBLIC_API** (commercial use needs a partnership, see policy-snapshot) | [S1], [S2], [S3] |
| `kakao-maps` | `https://dapi.kakao.com/v2/routing/walk` | WALKING | **OFFICIALLY_DOCUMENTED_PUBLIC_API** (requires Kakao Map API activation; free quota is limited to the first activated app) | [S4], [S5], [S6] |
| `kakao-maps` | `https://dapi.kakao.com/v2/routing/bicycle` | BICYCLING | OFFICIALLY_DOCUMENTED_PUBLIC_API (out of KR-W1 scope) | [S4] |
| `kakao-maps` | `https://dapi.kakao.com/v2/routing/publictraffic` | TRANSIT | OFFICIALLY_DOCUMENTED_PUBLIC_API (out of KR-W1 scope) | [S4] |

Historical note: on 2025-11-13 a Kakao staff DevTalk reply said there was no open walking API ([S7]). The current Kakao Developers docs ([S4], [S5]) do list `/v2/routing/walk`, and [S5] says the Kakao Map API usage method changed on **2026-07-21**. **inferred:** the routing endpoints became officially public with or around that change. W1 found no announcement that states the launch date.

Kakao Mobility also has a walking API, `https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions`. Its page says "제휴 파트너 전용 API … 사전 제휴 계약이 필요합니다" ([S8]), so it is **CONTRACT/PARTNERSHIP_ONLY**. tcache does not use it.

## 2. Capability matrix (official docs only)

| Provider × Mode | API exists | Distance | Duration | Geometry | Waypoints | Alternatives | Traffic | Toll | Segments | Future departure | Coord input | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kakao Maps × WALKING | Yes, GET `/v2/routing/walk` | `route.properties.totalDistance` (m) | `totalTime` (s) | `legs[].steps[].path.points` `[x,y]` | ≤5 `via_x/via_y` | Not documented | N/A | N/A | legs/steps with `guidance` | Not documented | WGS84 (default), WTM, TM, WCONGNAMUL | [S4] |
| Kakao Maps × DRIVING | **No** | — | — | — | — | — | — | — | — | — | — | [S4], [S6] |
| Kakao Mobility × DRIVING | Yes, GET `/v1/directions` | `summary.distance` (m) | `summary.duration` (s) | `sections[].roads[].vertexes` (flat x,y) | ≤5, total route < 1,500 km | `alternatives=true` | `roads[].traffic_speed`, `traffic_state` | `summary.fare.toll` (KRW), `car_hipass`, `avoid=toll` | sections/roads/guides | separate `GET /v1/future/directions` (`departure_time` YYYYMMDDHHMM) | WGS84 `x,y` | [S1], [S9] |
| Kakao Mobility × WALKING | Partner-only | (distance, duration, vertexes, ≤5 waypoints) | | | | | | | | | | [S8] |
| TMAP × WALKING | Yes, POST `https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1` | `totalDistance` (m, on SP point) | `totalTime` (s) | GeoJSON `LineString` features | `passList` ≤5 | Not documented | N/A | N/A | Point/LineString features, `turnType`, `facilityType` | Not documented | WGS84GEO (default), EPSG3857, KATECH | [S10] |
| TMAP × DRIVING | Yes, POST `https://apis.openapi.sk.com/tmap/routes?version=1` | `totalDistance` (m) | `totalTime` (s) | GeoJSON `LineString` | `passList` ≤5 | Not documented (one route per call) | `trafficInfo=Y` gives per-line `traffic` [start,end,congestion,speed] | `totalFare` (KRW), per-segment `fare`, `tollgateFareOption`, `carType` | LineString/Point features | Separate "타임머신 자동차 길 안내" product (W1 did not inspect its doc) | WGS84GEO default | [S11], [S12] |
| Naver Cloud Maps × DRIVING (Directions 5/15) | Yes, GET `https://maps.apigw.ntruss.com/map-direction/v1/driving` | `summary.distance` (m) | `summary.duration` (**ms**) | `path` | ≤5 (D5), D15 for more | up to 3 `option` values (one route per option) | real-time traffic, `section` congestion | `tollFare`, `taxiFare`, `fuelPrice` | `section`, `guide` | Not documented | lon,lat | [S13] |
| Naver Cloud Maps × WALKING | **No** (the doc has no pedestrian mode) | | | | | | | | | | | [S13], [S14] |
| Google Routes × KR DRIVING | **Not available in KR** | | | | | | | | | | | [S15] |
| Google Routes × KR WALKING | **Not available in KR** | | | | | | | | | | | [S15] |
| Self-hosted OSM router (OTP/OSRM/Valhalla) × KR | Possible but not a vendor API; quality unknown | | | | | | none | none | | | | RESEARCH_ONLY, no official KR quality source |

Google coverage for South Korea ([S15], page updated 2026-09-28): Driving Directions "—", Walking Directions "—", Biking "—", Traffic Layer "—". Map tiles and Geocoding are available.

## 3. Qualification (per Provider × Mode)

| Provider × Mode | Classification | Reason |
|---|---|---|
| Kakao Maps × WALKING | **QUALIFIED_BUT_CREDENTIAL_REQUIRED** | Public documented API and live request method are known. `KAKAO_REST_API_KEY` is MISSING locally, and Kakao Map API activation is needed. Production is blocked by the cache policy (see policy-snapshot). |
| Kakao Mobility × DRIVING | **QUALIFIED_BUT_CREDENTIAL_REQUIRED** | Public documented API. `KAKAO_MOBILITY_API_KEY` is MISSING. Production needs a commercial partnership, and caching is restricted. |
| TMAP × WALKING | **QUALIFIED_BUT_CREDENTIAL_REQUIRED** | Public documented API. A new `TMAP_APP_KEY` is needed. The terms allow storage for up to 24h. |
| TMAP × DRIVING | **QUALIFIED_BUT_CREDENTIAL_REQUIRED** | Same as TMAP × WALKING. |
| Kakao Mobility × WALKING | ELIMINATED_NO_PUBLIC_API | Partner-only ([S8]) |
| Kakao Maps × DRIVING | ELIMINATED_NO_PUBLIC_API | No driving endpoint ([S4]) |
| Naver Cloud × DRIVING | ELIMINATED_POLICY | Maps terms Art.7 ⑪ ban storing any result data and allow only one immediate use per call ([S16]). This is incompatible with a route cache. |
| Naver Cloud × WALKING | ELIMINATED_NO_PUBLIC_API | No pedestrian API ([S13]) |
| Google × KR DRIVING / WALKING | ELIMINATED_NO_PUBLIC_API | Coverage says not available ([S15]) |
| Self-hosted OSM (existing OTP infra) × KR WALK/DRIVE | RESEARCH_ONLY | No traffic or toll data, and Korean OSM road/footpath completeness is unverified. Possible future fallback. |

## Sources

| ID | Provider | Title | URL | Type |
|---|---|---|---|---|
| S1 | Kakao Mobility | 자동차 길찾기 (길찾기 API) | https://developers.kakaomobility.com/guide/navi-api/directions.html | Official API doc |
| S2 | Kakao Mobility | Kakaomobility Developers home (일반 vs 제휴 API) | https://developers.kakaomobility.com/ | Official |
| S3 | Kakao Mobility | 시작하기 (길찾기 API) — Kakao Developers REST API key | https://developers.kakaomobility.com/guide/navi-api/start.html | Official API doc |
| S4 | Kakao | 카카오맵 > REST API (경로 조회: 대중교통/도보/자전거) | https://developers.kakao.com/docs/ko/kakaomap/rest-api | Official API doc |
| S5 | Kakao | 카카오맵 > 이해하기 (제공 방식, 이용 정책, 2026-07-21 변경) | https://developers.kakao.com/docs/ko/kakaomap/common | Official |
| S6 | Kakao | 이용 안내 > 쿼터 | https://developers.kakao.com/docs/ko/getting-started/quota | Official quota/pricing |
| S7 | Kakao (staff, DevTalk) | 카카오 도보 길찾기 API 제공 받을수 있나요? (2025-11-13) | https://devtalk.kakao.com/t/api/147134 | Official forum staff reply, **superseded by S4** |
| S8 | Kakao Mobility | 도보 길찾기 (affiliate) | https://developers.kakaomobility.com/affiliate/walking/directions | Official API doc |
| S9 | Kakao Mobility | 미래 운행 정보 길찾기 | https://developers.kakaomobility.com/guide/navi-api/future.html | Official API doc |
| S10 | TMAP (SK/TMAP Mobility) | 보행자 경로안내 | https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRoutePedestrianDoc | Official API doc |
| S11 | TMAP | 자동차 경로안내 | https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRouteDoc | Official API doc |
| S12 | SK open API | API 사용 요금 (TMAP) | https://openapi.sk.com/products/calc?svcSeq=4&menuSeq=5 | Official pricing |
| S13 | Naver Cloud | Directions 5 API | https://api.ncloud-docs.com/docs/application-maps-directions5 | Official API doc |
| S14 | Naver Cloud | Maps 개요 | https://guide.ncloud-docs.com/docs/application-maps-overview | Official |
| S15 | Google | Google Maps Platform Coverage Details | https://developers.google.com/maps/coverage | Official coverage |
| S16 | Naver Cloud | Maps 서비스 이용약관 (2025-03-20 시행) | https://xv-ncloud.pstatic.net/images/provision/[민간]Maps서비스이용약관_v0.4_(CLEAN)_1742433558704.pdf (linked from https://www.ncloud.com/policy/terms/svc) | Official terms |
