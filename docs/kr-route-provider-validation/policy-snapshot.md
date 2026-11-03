# KR Route Provider — Policy Snapshot (KR-W1)

- Accessed: 2026-10-05
- Each claim is tagged **explicit** (quoted or tabulated in the source) or **inferred**.
- Source IDs refer to `candidate-source-matrix.md`. P-sources are listed at the end.

## Policy matrix

| Provider (mode) | Price beyond free | Free quota | Rate limit | Commercial use | Route caching / storage | Map SDK dependency / other map | Attribution |
|---|---|---|---|---|---|---|---|
| Kakao Maps (WALKING `/v2/routing/walk`) | 10원/건 via Biz Wallet paid API (explicit, [S6]) | 1,000건/**day**, only for the **first Kakao Map-activated app per developer account** (explicit, [S6], [S5]). The overall Kakao monthly quota is 3,000,000건 for all APIs combined (explicit, [S6]). | 429 on quota exhaustion (explicit, [S5]). Platform hard limits: request ≤30s, ≥10M calls/day hard cap (explicit, [P1] Art.6) | No route-specific clause found → **UNKNOWN**. [P1] Art.5 forbids "허가되지 않은 상업적 목적으로 … 판매, 거래, 재판매" (explicit) | **Restricted.** [P1] Art.5 forbids caching Kakao data "사용자 환경을 개선하기 위한 목적 외 다른 목적으로" or not keeping cached data fresh (explicit). [P2] Art.11③ bans copying/duplicating API data without written consent (explicit). Kakao Map staff replies: temporary caching (Redis/memory, 1–24h TTL) is prohibited ([P3], 2026-09-14), and storing responses in a DB is not allowed; re-query in real time and discard after display ([P4], 2026-09-07). Official staff replies, **not terms text**. | Response includes `landingUrl` to Kakao Map (explicit, [S4]). No clause found requiring display on Kakao Map → **UNKNOWN** | Logo use follows the design guide (recommended, explicit, [S5]). Trademark rules in [P1] Ch.3. Mandatory route attribution → **UNKNOWN** |
| Kakao Mobility (DRIVING `/v1/directions`) | 8원/건 up to 1M/month, future directions 8원/건 (explicit, [P5]) | 10,000건/day for car directions, 5,000/day for future directions (explicit, [P5], [S6]) | Same Kakao platform limits ([P1]). Per-second limit → **UNKNOWN** | **Commercial use needs a prior partnership contract, even within the free quota** (Kakao Mobility partnership team staff reply, 2026-09-02, [P6]). Non-commercial use within the free quota needs no partnership ([P7], 2026-09-21). Pricing page itself makes no commercial distinction ([P5]) | Same Kakao Developers terms and operating policy apply because the same REST key is used (**inferred** from [S3]). See the Kakao Maps row. | Doc shows vertexes for drawing. Other-map rendering clause → **UNKNOWN** | **UNKNOWN** |
| TMAP (WALKING, DRIVING) | Premium post-paid **11원/건** for the 경로안내 group (car, pedestrian, time-machine, image, truck) (explicit, [S12]) | Free plan **1,000건/day** for the 경로안내 group. Lite plan 10,000건/day at 2,200,000원/month VAT incl. (explicit, [S12]). **inferred:** the table rowspan suggests the quota is shared across the group. Verify in W2. | Per-second limit → **UNKNOWN** | Free-trial terms: creating multiple projects for the same service may be treated as illegal use (explicit, [P8]). Commercial clause → **UNKNOWN** | **"TMAP Open API를 이용하여 얻어진 데이터는 저장 후 24시간 이상 사용할 수 없습니다."** (explicit, [P8]). This fits a cache TTL ≤ 24h. | **UNKNOWN** | **UNKNOWN** |
| Naver Cloud Maps (DRIVING only) | Directions 5: 5원/건. Directions 15: 20원/건 (explicit, [P9]) | New 'Maps' product: D5 60,000/month, D15 3,000/month, **representative account only** (explicit, [P9], [S14]). The AI NAVER API legacy free quota ended 2025-07-01 (explicit, [P9]) | **UNKNOWN** | Resale or repackaging of the API is banned (Art.7 ⑫, explicit, [S16]) | **Prohibited.** Art.7 ⑪: results may be used only once, immediately. Storing them, putting them in a DB, or reusing them is banned (explicit, [S16]) | **UNKNOWN** (no clause found in the terms) | The company may require its logo or a designated mark on result data (Art.7 ⑩, explicit, [S16]) |
| Google Routes (KR) | n/a | n/a | n/a | n/a | n/a | n/a | n/a. KR driving/walking not available ([S15]) |

## tcache impact

1. tcache's main job is to cache provider route results in Redis. The default `ROUTE_CACHE_TTL_SECONDS=3600` comes from `.env.example:9`. Every Korean vendor restricts this:
   - Naver bans it outright.
   - Kakao (Maps and Mobility) bans it per staff replies, and the operating-policy text is ambiguous.
   - TMAP allows it if the data is used for no more than 24h.
2. KR-W2 live benchmark calls are uncached test calls within the free quotas, so they are allowed under all of the above (**inferred**). The policy issue blocks **production caching**, not W2.
3. Production use of Kakao for KR WALK/DRIVE needs written confirmation from Kakao / Kakao Mobility that tcache's TTL cache is allowed, or a partnership contract. This is a human action.

## P-sources

| ID | Title | URL |
|---|---|---|
| P1 | Kakao Developers 운영정책 (시행 2026-04-20) | https://developers.kakao.com/terms/latest/ko/site-policies |
| P2 | Kakao Developers 플랫폼 서비스 약관 (시행 2026-02-06) | https://developers.kakao.com/terms/latest/ko/site-terms |
| P3 | DevTalk staff reply: 이동 소요 시간(totalTime) 단기 캐싱 허용 여부 (2026-09-14) | https://devtalk.kakao.com/t/api-totaltime-caching/151653 |
| P4 | DevTalk staff reply: 경로 기반 장소 추천 서비스의 저장 기능 (2026-09-07) | https://devtalk.kakao.com/t/topic/151514 |
| P5 | Kakao Mobility 가격 및 문의 | https://developers.kakaomobility.com/price/ |
| P6 | DevTalk staff reply (kakaonavi, 2026-09-02): 상업적 이용 시 제휴 계약 필수 | https://devtalk.kakao.com/t/directions-api/151465 |
| P7 | DevTalk staff reply (2026-09-21): 비상업적 무료 쿼터 내 제휴 불필요 | https://devtalk.kakao.com/t/directions-api/151793 |
| P8 | TMAP API 약관 | https://tmapapi.tmapmobility.com/terms.html |
| P9 | Naver Cloud notice: Maps 상품 신규 출시 및 AI NAVER API 지도 API 무료 이용량 종료 (2025-05-28, updated 2025-06-24) | https://www.ncloud.com/support/notice/all/1965 |
