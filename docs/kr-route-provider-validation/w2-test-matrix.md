# KR-W2 Live Benchmark — Test Matrix (designed in KR-W1, NOT executed)

No results exist yet. Do not fill in results until W2 runs the live calls.

## Step 0 — freeze coordinates (required before any benchmark call)

The coordinates below are **approximate (target ±300 m)** and were chosen in W1 without calling any API. The only exception is KR-METRO-OUTSKIRT-WALK, whose pair is copied from the official Kakao `/v2/routing/walk` sample request ([S4]).

In W2 step 0:
1. Resolve each named place with Kakao Local keyword search (`/v2/local/search/keyword`, 100,000/day free).
2. Record the returned `x,y` and `place_name` in `raw/coordinates.json`.
3. Use only those frozen values afterwards.

## Providers under test

| Mode | Providers | Credential |
|---|---|---|
| WALKING | Kakao Maps `/v2/routing/walk`; TMAP `/tmap/routes/pedestrian` | `KAKAO_REST_API_KEY`; `TMAP_APP_KEY` (new) |
| DRIVING | Kakao Mobility `/v1/directions`; TMAP `/tmap/routes` | `KAKAO_MOBILITY_API_KEY`; `TMAP_APP_KEY` |

## Matrix

| ID | Origin (approx lat,lng) | Destination (approx lat,lng) | Scale | Mode | Providers |
|---|---|---|---|---|---|
| KR-SEOUL-WALK | 경복궁역 (37.5757, 126.9735) | 명동역 (37.5609, 126.9863) | ~2–2.5 km | WALKING | Kakao Maps, TMAP |
| KR-SEOUL-DRIVE | 서울역 (37.5547, 126.9707) | 코엑스 / 삼성역 (37.5088, 127.0631) | ~11–13 km | DRIVING | Kakao Mobility, TMAP |
| KR-METRO-OUTSKIRT-WALK | 판교역 (37.394776627382875, 127.11119669891646) **[official Kakao sample]** | 성남시청 부근 (37.4199323570413, 127.12629039752096) **[official Kakao sample]** | ~4 km (Kakao sample response: 4,025 m / 3,914 s) | WALKING | Kakao Maps, TMAP |
| KR-METRO-OUTSKIRT-DRIVE | 수원역 (37.2657, 127.0001) | 동탄역 (37.2000, 127.0960) | ~12–15 km | DRIVING | Kakao Mobility, TMAP |
| KR-BUSAN-OR-DAEGU-WALK | 부산역 (35.1152, 129.0422) | 남포동 BIFF광장 (35.0985, 129.0280) | ~2.5 km | WALKING | Kakao Maps, TMAP |
| KR-BUSAN-OR-DAEGU-DRIVE | 부산역 (35.1152, 129.0422) | 해운대해수욕장 (35.1587, 129.1604) | ~15–18 km (urban expressway, may include toll) | DRIVING | Kakao Mobility, TMAP |
| KR-REGIONAL-CITY-WALK | 전주 경기전 (35.8153, 127.1497) | 전주시청 (35.8242, 127.1480) | ~1–1.5 km | WALKING | Kakao Maps, TMAP |
| KR-REGIONAL-CITY-DRIVE | 전주역 (35.8497, 127.1617) | 전주한옥마을 (35.8150, 127.1530) | ~5–6 km | DRIVING | Kakao Mobility, TMAP |
| KR-RURAL-WALK | 안동 하회마을 매표소 (36.5390, 128.5180, verify) | 하회마을 양진당 (36.5395, 128.5185, verify) | ~1–1.5 km | WALKING | Kakao Maps, TMAP |
| KR-RURAL-DRIVE | 안동 하회마을 (36.5390, 128.5180) | 안동시청 (36.5684, 128.7294) | ~20–25 km (rural national/local roads) | DRIVING | Kakao Mobility, TMAP |
| KR-INTERCITY-DRIVE (extra: toll check) | 서울역 (37.5547, 126.9707) | 부산역 (35.1152, 129.0422) | ~390–420 km (Gyeongbu Expressway, toll expected) | DRIVING | Kakao Mobility, TMAP |
| KR-SEOUL-WALK-WAYPOINT (extra: waypoints) | 경복궁역 | 명동역 via 광화문광장 (37.5720, 126.9769) and 서울시청 (37.5663, 126.9779) | ~2.5 km, 2 via points | WALKING | Kakao Maps, TMAP |

## Success / geometry / latency conditions (same for every row)

**Success** (all must hold):
- HTTP 200 and provider status OK (`status=OK` for Kakao Maps, `result_code=0` for Kakao Mobility, `FeatureCollection` present for TMAP).
- distance > 0 and duration > 0.
- distance / straight-line distance between 1.0 and 2.5 (walk) or 1.0 and 3.0 (drive). Values outside the range are flagged `SUSPECT`, not counted as failures.
- Walking speed implied by distance/duration between 2.5 and 6 km/h.
- Driving urban average speed between 8 and 80 km/h. Intercity between 40 and 110 km/h.

**Geometry**:
- At least 2 points.
- First point within 150 m of the origin and last point within 150 m of the destination (snapped).
- Every point inside the KR bbox (33.0–38.7 N, 124.5–131.0 E).
- No consecutive jump > 2 km (walk) or > 5 km (drive).
- Polyline length within ±10% of the reported distance.
- Waypoint rows: the path passes within 150 m of each via point.

**Driving extra**: record toll (`fare.toll` / `totalFare`). Expect toll > 0 for KR-INTERCITY-DRIVE. Record whether traffic fields are present.

**Latency**:
- 5 sequential repetitions per provider per row, with a 1 s gap and a 10 s client timeout.
- Record p50, max, timeouts, and the geometry hash for each repetition. Any change in geometry across repetitions is stability evidence.

**Budget**: 12 rows × 2 providers × 5 repetitions = 120 calls, plus 13 geocoding calls. This is well within every free quota (Kakao walk 1,000/day, Kakao car 10,000/day, TMAP 1,000/day).

**Human review**: render each geometry on the testbed map and mark it NATURAL / ODD (detour, wrong side of river, highway on foot) in `human-validation.md`.
