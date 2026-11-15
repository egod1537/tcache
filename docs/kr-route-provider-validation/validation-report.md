# 한국 도보·자동차 Route Provider 재검증

검증일: 2026-10-31 (KST). 코드 기준: `0554644018b44609bc93e74be67e0f6fef5260bf`.

**추천은 TMAP을 차기 실측 우선 후보로 두고, Kakao 도보·자동차를 비교 대상으로 유지하는 것이다. Production 전환 결정은 보류한다.** TMAP은 두 모드를 제공하고 데이터 사용 기간에 대한 명시적 제한이 있어 검토하기 쉽다. 다만 24시간 제한만으로 Redis 캐시, 상업적 재제공, 영구 Evidence 보관까지 허용된다고 결론 내릴 수 없다. 실경로 호출 0건이므로 품질·ETA·Latency 우열은 아직 판단할 수 없다.

## 범위와 Evidence 상태

- 기존 미커밋 조사 문서 4개는 수정하지 않았다. 원본 SHA-256은 `preservation-manifest.json`에 기록했다. 새 보고서가 2026-10-05 문서의 보완·정정 사항을 담는다.
- 현재 Worktree에는 `.env.example`, `otp/.env.example`만 있고, Kakao/TMAP/Naver 관련 환경변수는 설정되지 않았다. Key 값은 출력·저장하지 않았다. 다른 Worktree의 인증정보는 조회하지 않았다.
- Notion에서 제목 전체, `한국 도보`, `경로 API`, `Trasolve`로 검색했으나 해당 태스크를 식별하지 못했다. 원본 태스크의 본문·요구사항·현재 상태는 재확인하지 못했으며 Notion은 변경하지 않았다. 이 보고서는 사용자 지시와 로컬 W1 문서를 기준으로 작성했다.
- `preflight-evidence.json`: 5지역 × 2모드 × 2후보 = 20행. 전부 `MISSING_CREDENTIAL`, `networkCalls=0`. ETA/거리/Latency/geometry는 `null`. 인증 실패 HTTP 응답이나 지역별 경로 실패로 해석하면 안 된다.
- `prototype-evidence.json`: 합성 데이터로 기존 Kakao Mapper/Parser 재사용과 TMAP 비교용 정규화 검증 성공. 실제 Provider 응답 Evidence가 아니다.
- 변경 범위는 이 문서 디렉터리뿐이다. Production Provider 등록·선택·캐시 정책, 기존 PR, 다른 Worktree는 변경하지 않았다. 커밋·푸시하지 않았다.

## Provider 비교

| 후보 | 도보 | 자동차 | 거리 / ETA / geometry | 현재 적용 판단 |
|---|---|---|---|---|
| Kakao Maps | 공개 REST `/v2/routing/walk` | 해당 상품에 없음 | m / s / `legs[].steps[].path.points` | 기존 Adapter 재사용 가능. 캐싱 조건 해결 필요. [K1][K4][K5] |
| Kakao Mobility | affiliate 도보는 제휴 전용(W1 근거, 이번 문서 재확인 안 됨) | 공개 `/v1/directions` | m / s / `roads[].vertexes` | 기존 Adapter 재사용 가능. 상업 이용 제휴와 데이터 저장 조건 확인 필요. [K2][K6] |
| TMAP | 공개 `/tmap/routes/pedestrian` | 공개 `/tmap/routes` | m / s / GeoJSON LineString | 양 모드의 차기 실측 1순위. 비교용 최소 Prototype 준비. [T1][T2][T3] |
| Naver Cloud Maps | 공개 Maps 목록에 도보 API 없음 | Directions 5 / 15 | m / ms(W1 기술 메모, 이번 단위 재확인 안 됨) / `[lon,lat]` path | 자동차 응답 정규화는 가능하나 결과 저장·재사용 금지로 현재 캐시 서비스에 부적합. [N1][N2][N3] |
| Google Routes | KR coverage `—` | KR coverage `—` | 이번 비교 제외 | 범례는 미제공 **또는 낮은 품질/가용성**이다. W1의 단정적인 '불가'보다 이 표현이 정확하다. [G1] |
| 자체 OSM 라우터 | 엔진·데이터에 따라 가능 | 엔진·데이터에 따라 가능 | 엔진별 정규화 필요 | 한국 그래프·보행 연결성·교통/통행료 미검증. 기존 일본 OTP 결과는 한국 품질 근거가 아니다. |

문서상 API 존재는 계정별 권한 활성화·실호출 성공을 보장하지 않는다. Kakao Maps 도보는 공식 문서에서 지원을 재확인했다. '카카오 도보 공개 API가 없다'는 과거 정보로 제외하지 않는다. [K1]

## 비용·Quota·Rate Limit·정책

| 후보 | 무료 / 초과 요금 | Rate Limit | 캐싱·상업 이용 | Attribution·지도 종속성 |
|---|---|---|---|---|
| Kakao Maps 도보 | 일 1,000건; 초과 10원/건. 계정의 첫 Maps 활성화 앱만 무료. 공통 월 쿼터도 고려. [K3] | 경로 API의 초당 수치 미확인. 일 쿼터와 QPS를 구분 | 운영정책은 목적·최신성 조건을 언급한다. 담당자 답변은 Redis/메모리 1~24h 단기 캐싱을 금지한다. 문서 간 적용 범위를 서면 확인해야 한다. 상업용 재판매 허용으로 해석 불가. [K4][K5] | `landingUrl`은 있으나 지도 SDK 필수 여부·타사 지도 위 표시·경로 Attribution 의무는 확인되지 않음. [K1] |
| Kakao Mobility 자동차 | 일 10,000건; 무료 초과 월 100만건까지 8원/건, 초과 구간 별도 문의. VAT는 페이지상 명확하지 않음. [K7] | 초당 수치 미확인 | 담당자는 무료 쿼터 내라도 상업 목적이면 사전 제휴 계약이 필요하다고 답변. Maps 담당자 캐시 답변이 Mobility 계약 전체에 그대로 적용된다는 것은 추론이므로 별도 확인. [K6] | REST geometry 제공과 타사 지도 사용 허가는 별개. 의무 미확인 |
| TMAP 도보·자동차 | 경로안내 그룹 Free 일 1,000건, Lite 일 10,000건·월 2,200,000원, Premium 11원/건(VAT 포함). 그룹별 표이므로 모드 합산으로 예산을 잡고 계정 콘솔에서 확인. [T2] | 초당 수치 미확인. Free/Lite 한도 초과 차단은 QPS 수치가 아님 | 약관상 저장 후 24시간 이상 사용 불가. 동일 서비스용 복수 프로젝트 제한. 이 조항은 캐싱·재배포 전면 허가가 아니며 상업 서비스별 계약 범위는 미확인. [T3] | 기술적으로 REST만으로 요청 가능. 외부 지도 표시 권한·로고 규칙은 미확인 |
| Naver Cloud | W1: D5 월 60,000건 후 5원/건, D15 월 3,000건 후 20원/건(대표계정). 이번 최신 요금/공지 페이지 접근 실패: **현행 요금으로 확정하지 않음**. 과거 공식 공지에는 동일 수치 존재. [N4][N5] | 초당 수치 미확인 | 약관 제7조 ⑪은 응답 즉시 1회 사용만 허용하고 별도 저장·DB화·재사용 금지. ⑫는 API/SDK 재판매 금지. [N3] | ⑩은 회사 요청 시 지정 표시/로고 게재 준수. 지도 SDK와 별도 REST 호출 가능하나 타사 지도 표시 허용은 미확인. [N1][N3] |

무료 Quota 존재가 상업적 이용·무기한 시험 데이터 보관 허가는 아니다. 특히 W1의 'TMAP은 TTL≤24h이면 적합', '무료 시험 호출은 모두 허용'은 **미확정 추론**으로 낮춘다. TMAP 결과를 Git에 영구 보관하거나 Kakao 응답을 장기 보존하는 방식은 계약 확인 없이 권장하지 않는다. 벤치마크 Raw/normalized geometry 영구 보관도 별도 데이터 보관 권한을 확보한 뒤 진행한다.

## 지역별 실호출 현황

아래 각 행은 도보와 자동차 각각 Kakao(모드별 상품)·TMAP을 비교하도록 구성했다. 모든 수치는 미측정이다. 좌표는 원본 W1의 임시 좌표다.

| 지역 | 도보 구간 | 자동차 구간 | ETA / 거리 / geometry / 품질 / Latency / 오류 |
|---|---|---|---|
| 서울 도심 | 경복궁역 → 명동역 | 서울역 → 삼성역 | 미측정 / 미측정 / 미측정 / 미검증 / 미측정 / 미실행(인증정보 없음) |
| 수도권 교외 | 판교역 → 성남시청 부근 | 수원역 → 동탄역 | 동일 |
| 광역시(부산) | 부산역 → BIFF광장 | 부산역 → 해운대 | 동일 |
| 지방 중소도시 | 전주 경기전 → 전주시청 | 전주역 → 한옥마을 | 동일 |
| 시골 | 하회마을 매표소 → 양진당 | 하회마을 → 안동시청 | 동일 |

시골 도보 좌표 `(36.5390,128.5180)→(36.5395,128.5185)`는 직선 약 72m로 원본의 1~1.5km 설명과 불일치한다. 농촌 보행로를 대표하는 구간·실제 출입구로 교체하고 모든 좌표를 동결해야 한다. 수도권 '교외' 표본도 두 구간 모두 도시화된 지역이므로 비도심 대표성이 약하다. 교외 보조 표본을 추가하는 편이 좋다.

W1 계획은 12행×2후보×5회=120 경로 호출이며, 이번 도구는 핵심 10행×2후보 **단회 Smoke 전용**이다. 장거리 통행료·경유지 추가행, 지오코딩, 5회 반복 및 p50/max, geometry 변동 비교는 아직 실행하지 않았다. 좌표 확정 전에는 지역 품질 결과로 사용하지 않는다.

## 코드 검토와 Trasolve 계약 적합성

검토 파일: `route/server/types/route.ts`, `providers/provider.ts`, `providers/kakao/{mapper,parser,mobility,transit,http,errors,types}.ts`, `resolver/provider-policy.ts`, `cache/key.ts`, `.env.example`.

1. 요청은 좌표·출발/도착·경유지·mode를 공통 계약으로 표현할 수 있다. Kakao는 좌표 필수, 최대 5경유지다. TMAP도 비교용 요청 변환에서 동일 모델을 사용할 수 있다. TMAP 고유 장소 ID를 공통 계약에 추가할 필요는 없으며 좌표 입력을 우선한다.
2. 응답 계약 `RouteProviderResult.result`는 `unknown`이다. 현재 Kakao의 `distanceMeters`, `durationSeconds`, `path`, bounds, legs/steps 구조는 지역 정규화 타입이지 전체 Provider 공통 보장 타입이 아니다. TMAP은 비교용 최소 `{distanceMeters,durationSeconds,path}`로 변환 가능함을 합성 데이터로 확인했다. 완전한 TMAP Adapter의 legs/steps·오류·capabilities는 미구현이다.
3. Kakao driving은 `departureTime`을 전송하지 않으며 `supportsDepartureTime`도 명시되지 않는다. 공통 필드를 받았다는 이유로 미래 출발 ETA가 계산됐다고 표시하면 안 된다. 즉시 출발 `/v1/directions`와 미래 운행 상품을 분리해야 한다. 이번 Smoke는 legacy 정규화로 출발시각 없이 요청하며 호출시각을 기록한다. [K2]
4. Kakao driving `priority=RECOMMEND` 고정, `routingPreference` 미반영. `fare.toll`, `fare.taxi`, 도로별 교통정보는 기존 Parser 정규화 결과에서 누락된다. 실측 비교에선 응답 수신 시 별도로 추출해야 한다. 이번 최소 도구는 이 필드를 측정하지 않는다.
5. 도보 `route_mode` 미전송은 공식 기본값 `BROAD_FIRST` 사용이다. 지원 불가가 아니라 선택 옵션 미노출이다. `TOO_MANY_SEARCH_LINK`, `ROUTE_RESULT_NOT_FOUND`는 현재 일반 UNAVAILABLE로 분류된다. [K1]
6. `provider-policy.ts`의 KR 기본값은 DRIVING→kakao-mobility, 나머지→kakao-maps. TMAP Production 등록에는 닫힌 Provider 이름 union·registry·capabilities·구성 변경이 필요하다. 현재 정책은 그대로 뒀다.
7. 기본 TTL 3600초와 Provider별 캐시 키는 기술적 구성이다. 공급자별 데이터 사용 허가를 대신하지 않는다. resolver의 단일 Provider 선택은 지역별 자동 fallback을 제공하지 않는다. 품질 근거 없이 Production fallback을 추가하지 않는다.

## 최소 Prototype 및 재실행

`validation.mjs`는 Production 의존성 추가 없이 기존 TypeScript Mapper/Parser를 직접 불러온다. Node 24의 `--experimental-transform-types`와 `.js→.ts` 로컬 resolve hook을 사용한다. 이 환경의 기본 Node 26은 해당 flag를 제거했고 strip-only 모드에서 기존 parameter property를 처리하지 못하므로 **Node 24 사용**이 필요하다. 서버 전체 테스트/타입체크는 의존성 미설치로 실행하지 않았으며 그 통과를 주장하지 않는다.

```sh
# Node 24 실행 파일이 PATH에 있을 때. 어떤 명령도 Key 값을 인자로 받지 않는다.
node --experimental-transform-types docs/kr-route-provider-validation/validation.mjs --self-test
node --experimental-transform-types docs/kr-route-provider-validation/validation.mjs
```

Preflight는 네트워크를 사용하지 않는다. Self-test는 좌표 순서, 양 Kakao Parser·TMAP geometry 정규화, 도보 기본 이름, 빈/실패 응답·한국 밖 geometry 검사를 포함한다. 합성 데이터 검증 11항목 성공. 원래 Kakao Vitest 스위트 실행과는 구분한다.

실호출은 Key가 환경에 준비된 상태에서 아래와 같이 수행할 수 있다. `--coordinates` JSON은 코드의 `cases`와 같은 `[지역ID,mode,[lat,lon],[lat,lon]]` 형식의 10개 확정 행이다. `--policy-reviewed`는 해당 계정·상품의 시험 목적 및 결과 취급 조건을 검토했다는 실행자의 표시이며, 이 조사에서 약관 승인을 받았다는 뜻이 아니다.

```sh
node --experimental-transform-types docs/kr-route-provider-validation/validation.mjs --live --coordinates=/tmp/kr-reviewed-coordinates.json --policy-reviewed
```

도구는 `KAKAO_REST_API_KEY`, `KAKAO_MOBILITY_API_KEY`(없으면 REST key), `TMAP_APP_KEY`를 사용한다. Key는 인증 헤더로만 보내고 응답 헤더·원문·URL·공급자 오류 메시지를 출력하지 않는다. timeout 10초, 순차 호출 간 1초, 최대 20회이며 자동 재시도는 없다. geometry는 메모리에서 계산하고 출력은 좌표 없는 품질 지표·해시·HTTP 코드만 포함한다. HTTP 실패·timeout과 schema 오류를 기록하지만 상세 upstream 오류 분류는 향후 개선 대상이다. Naver는 캐시 부적합으로 이 Smoke 대상에서 제외했다.

실측에선 인증정보 없는 Provider 행은 건너뛴다. SUCCESS는 양수 합계와 path 존재를 뜻하며 geometry 품질은 별도 판정이다. 품질 검사는 bbox, endpoint 150m, 점간 점프, geometry 길이 오차, 우회율·평균속도 이상을 표시한다. 보행로 통행 가능·횡단보도·일방통행·실제 ETA 오차는 현장/지도 검토 전 `PENDING`이다. 검사 통과를 경로 자연스러움 또는 ETA 정확성 증거로 취급하지 않는다.

## 추천과 미검증 항목

- **TMAP:** 두 모드를 한 공급자로 검증할 첫 후보. Free 한도로 120회 계획은 수치상 충분하나 해당 계정 잔여량·모드 합산·QPS를 확인해야 한다. 계약상 캐시/출력/데이터 보관 범위와 Attribution·타사 지도 사용을 확인한 뒤 실측한다.
- **Kakao:** 기존 Adapter를 활용할 비교군. 실사용 전 Maps 캐싱 조건, Mobility 상업 제휴와 별도 보관 조건을 해결해야 한다. 상업 허가와 캐시 허가는 별개의 확인 항목이다.
- **Naver:** 자동차 계산·정규화 자체는 가능하지만 현재 tcache에는 저장 제한이 직접 충돌한다. 별도 계약이나 캐시하지 않는 별도 사용 흐름이 없다면 채택하지 않는다.
- **미검증:** 계정 키/권한/활성화, 확정 좌표, 모든 실제 ETA·거리·geometry·지역별 성공률·Latency, 반복 안정성, ETA 실측 오차, 통행료·교통정보, 2개 추가행, 향후 출발시각, 각 공급자 QPS·429 복구, 상업 이용·캐시·영구 Evidence 보관·Attribution·지도 종속성, Naver 최신 가격/Quota, Notion 태스크 본문.

태스크 전체는 **조사 및 오프라인 Prototype 완료, 실제 benchmark 미완료** 상태다. 인증정보 없이 실측값을 추정해서 채우지 않는다.

## 공식 출처 (2026-10-31 접근)

| ID | 출처 | 이번 확인 내용 |
|---|---|---|
| K1 | [Kakao Maps REST](https://developers.kakao.com/docs/ko/kakaomap/rest-api) | 도보 endpoint, 경유지, 기본 옵션·경로 응답 |
| K2 | [Kakao Mobility 자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions.html) | GET endpoint·응답 규격 |
| K3 | [Kakao 쿼터·요금](https://developers.kakao.com/docs/ko/getting-started/quota) | 도보 무료/유료, 계정 조건 |
| K4 | [Kakao 운영정책](https://developers.kakao.com/terms/ko/site-policies) | 제5조 20항 캐시 목적·최신성 조건 |
| K5 | [Kakao 담당자 단기 캐싱 답변](https://devtalk.kakao.com/t/api-totaltime-caching/151653) | 2026-09-14 담당자 답변. 약관 본문과 구분 |
| K6 | [Mobility 담당자 상업 이용 답변](https://devtalk.kakao.com/t/directions-api/151465) | 2026-09-02 기술 제휴 담당자 답변. 계약 원문은 미확인 |
| K7 | [Mobility 가격](https://developers.kakaomobility.com/price/) | 자동차 무료량·초과요금 |
| T1 | [TMAP 기업 API 소개](https://www.tmapmobility.com/service/corporate/api) | 도보·자동차 공개 상품 |
| T2 | [SK Open API 요금표](https://openapi.sk.com/products/calc?svcSeq=4&menuSeq=5) | Free/Lite/Premium·VAT·초과 차단 |
| T3 | [TMAP API 약관](https://tmapapi.tmapmobility.com/terms.html) | 24시간 이후 사용 제한·복수 프로젝트 제한 |
| T4 | [TMAP 경로안내 샘플](https://tmap-skopenapi.readme.io/reference/경로안내-샘플예제) | JSON POST·GeoJSON·도보 이름·거리/시간. 기존 hash 문서 링크는 정적 본문 대신 메뉴만 반환 |
| N1 | [Naver Directions 5](https://api.ncloud-docs.com/docs/application-maps-directions5) | 자동차·경유지·실시간 교통 |
| N2 | [Naver Maps 개요](https://guide.ncloud-docs.com/docs/application-maps-overview) | 공개 API 목록, 도보 상품 없음 |
| N3 | [Naver Maps 약관 PDF](https://xv-ncloud.pstatic.net/images/provision/%5B%EB%AF%BC%EA%B0%84%5DMaps%EC%84%9C%EB%B9%84%EC%8A%A4%EC%9D%B4%EC%9A%A9%EC%95%BD%EA%B4%80_v0.4_(CLEAN)_1742433558704.pdf) | 제7조 ⑩~⑫. 2025-03-20판, 이번 PDF 확인. 최신판 연결까지 확인한 것은 아님 |
| N4 | [Naver 2025 Maps 공지](https://www.ncloud.com/support/notice/all/1965) | 이번 fetch timeout, W1 근거로만 유지 |
| N5 | [Naver 과거 가격변경 공지](https://www.ncloud.com/support/notice/all/1424) | 과거 요금·대표계정 무료량. 현행 확정용으로 사용하지 않음 |
| G1 | [Google Coverage](https://developers.google.com/maps/coverage) | KR driving/walking `—`, 범례 확인 |
