# tcache

Trasolve와 troute에서 공용으로 사용하는 캐시 서버의 기반 프로젝트입니다. 현재 단계는 실제 캐시 정책이나 외부 API 연동이 아닌, Route Cache와 AI Response Cache를 독립적으로 개발하고 배포할 수 있는 실행 환경을 제공합니다.

## 구조와 분리 원칙

```text
ai/
├── server/           # AI Response Cache 서버 기능
└── testbed/          # AI Cache testbed 기능
route/
├── server/           # Route Cache 서버 기능
└── testbed/          # Route Cache testbed 기능
apps/
├── server/src/       # 공용 서버 인프라와 실행 진입점
└── testbed/src/      # testbed 공용 UI/HTTP 코드와 앱 셸
packages/common/      # 실제로 범용적인 공유 타입
deploy/
├── docker/           # 컨테이너 이미지와 Nginx 설정
└── cloudflare/       # Cloudflare Tunnel 예시 및 문서
```

`route`와 `ai`는 각각 `server`와 `testbed`를 소유하며 서로의 내부 구현을 import하지 않습니다. 공유 코드는 `apps`의 실행 셸과 Redis client, config, health/HTTP utility, 범용 타입 같은 인프라 계층으로 제한합니다. 이 경계를 유지하면 향후 각 시스템을 별도 프로세스나 컨테이너로 분리할 수 있습니다.

## 기술 스택

- Server: Node.js 22, TypeScript, Fastify, Redis, PostgreSQL
- Testbed: React, Vite, TypeScript, Nginx
- Workspace: pnpm
- Infra: Docker Compose, Cloudflare Tunnel
- Quality: ESLint, Prettier, Vitest
- Deploy: GitHub Actions, macOS self-hosted runner

## 로컬 실행

Node.js 22 이상과 pnpm 10이 필요합니다. Redis를 로컬 `6379` 포트에서 실행한 뒤 아래 명령을 사용합니다. 로컬 `/status`에서 PostgreSQL도 `ok`로 확인하려면 PostgreSQL을 별도로 실행하고 `DATABASE_URL`을 설정합니다. 값이 없으면 서버 기능은 시작되지만 PostgreSQL 상태는 `error`로 표시됩니다.

```bash
cp .env.example .env
pnpm install
pnpm dev
```

- `pnpm dev`: server와 testbed 동시 실행
- `pnpm dev:server`: server만 실행
- `pnpm dev:testbed`: testbed만 실행
- `pnpm lint`: 정적 검사
- `pnpm format`: 코드 포맷
- `pnpm typecheck`: TypeScript 검사
- `pnpm test`: 서버 endpoint 테스트
- `pnpm build`: 전체 빌드

기본 로컬 주소는 server `http://localhost:3200`, testbed `http://localhost:3201`입니다. Vite가 `/api`와 `/health` 요청을 server로 proxy합니다.

## Docker 실행

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3200/health
```

Compose는 `tcache-server`, `tcache-testbed`, `redis`, `postgres`를 실행합니다. server와 testbed는 loopback에만 bind되고 Redis 및 PostgreSQL 포트는 host에 publish되지 않습니다. Redis 데이터는 `redis-data`, PostgreSQL 데이터는 `postgres-data` named volume에 저장됩니다. `docker compose down`은 두 volume을 유지하며, `docker compose down -v`는 영속 데이터를 삭제하므로 운영 환경에서 사용하지 않습니다.

## 환경 변수

| 변수                               | 기본값                    | 설명                                                    |
| ---------------------------------- | ------------------------- | ------------------------------------------------------- |
| `NODE_ENV`                         | `development`             | 실행 환경                                               |
| `TCACHE_PORT`                      | `3200`                    | 로컬 server/host 포트                                   |
| `TCACHE_TESTBED_PORT`              | `3201`                    | 로컬 testbed/host 포트                                  |
| `REDIS_URL`                        | `redis://localhost:6379`  | Redis 연결 주소                                         |
| `POSTGRES_PASSWORD`                | 비어 있음                 | Compose PostgreSQL 사용자 암호                          |
| `DATABASE_URL`                     | 비어 있음                 | PostgreSQL 연결 문자열                                  |
| `GIT_COMMIT_SHA`                   | `dev`                     | `/status`에 노출할 배포 버전                            |
| `ROUTE_JOB_TTL_SECONDS`            | `86400`                   | Route Job 기록 보존 시간                                |
| `ROUTE_CACHE_TTL_SECONDS`          | `3600`                    | Route 결과 cache TTL                                    |
| `ROUTE_PROVIDER_TIMEOUT_MS`        | `30000`                   | Route provider 요청 제한 시간                           |
| `TCACHE_MATRIX_CONCURRENCY`        | `4`                       | Matrix pair 동시 처리 수                                |
| `ROUTE_PROVIDER`                   | `mock`                    | `auto`, `mock`, Google, Kakao, Ekispert, NAVITIME, OTP  |
| `JAPAN_TRANSIT_PROVIDER`           | `ekispert`                | JP TRANSIT 기본 adapter (`ekispert`, `navitime`, `otp`) |
| `ROUTE_PROVIDER_OVERRIDE_ENABLED`  | `true`                    | 요청별 provider override 허용                           |
| `ROUTE_PROVIDER_RAW_DEBUG_ENABLED` | `true`                    | redacted raw provider response 기록                     |
| `ROUTE_TIME_ZONE`                  | `Asia/Seoul`              | 국가·요청 timezone이 없을 때 day/bucket fallback        |
| `GOOGLE_MAPS_API_KEY`              | 비어 있음                 | Google Routes API key                                   |
| `KAKAO_REST_API_KEY`               | 비어 있음                 | Kakao Maps REST API key                                 |
| `KAKAO_MOBILITY_API_KEY`           | 비어 있음                 | Kakao Mobility API key                                  |
| `NAVITIME_API_KEY`                 | 비어 있음                 | NAVITIME RapidAPI key                                   |
| `NAVITIME_API_BASE_URL`            | NAVITIME RapidAPI URL     | NAVITIME Total Navi API base URL                        |
| `EKISPERT_API_KEY`                 | 비어 있음                 | Ekispert Standard/Trial access key                      |
| `EKISPERT_API_BASE_URL`            | `https://api.ekispert.jp` | Ekispert Standard API base URL                          |
| `OTP_BASE_URL`                     | `http://localhost:8080`   | Experimental OTP service base URL                       |
| `OTP_PROVIDER_ENABLED`             | `false`                   | OTP adapter를 명시적으로 활성화                         |
| `OTP_REQUEST_TIMEOUT_MS`           | `30000`                   | OTP GraphQL 요청 제한 시간                              |
| `OTP_VERSION`                      | 비어 있음                 | 관측·cache metadata용 OTP 버전                          |
| `OTP_GRAPH_BUILD_ID`               | 비어 있음                 | graph 재빌드별 cache identity                           |
| `OTP_GTFS_DATASET_VERSION`         | 비어 있음                 | 현재 graph의 GTFS dataset identity                      |
| `OTP_OSM_DATASET_VERSION`          | 비어 있음                 | 현재 graph의 OSM dataset identity                       |
| `AI_JOB_TTL_SECONDS`               | `86400`                   | AI Job 기록 보존 시간                                   |
| `AI_CACHE_DEFAULT_TTL_SECONDS`     | `3600`                    | AI 응답 cache TTL                                       |
| `AI_PROVIDER_TIMEOUT_MS`           | `120000`                  | AI provider 요청 제한 시간                              |
| `AI_PROVIDER`                      | `mock`                    | `mock` 또는 `gemini`                                    |
| `GEMINI_API_KEY`                   | 비어 있음                 | Gemini API key                                          |

`.env`와 tunnel credential은 Git에 커밋하지 않습니다. Docker 환경에서는 server가 내부 주소 `redis://redis:6379`를 사용하고, `DATABASE_URL`은 `postgresql://tcache:<URL-encoded password>@postgres:5432/tcache` 형태로 설정합니다. PostgreSQL은 장기 요청 이력과 분석 metadata용이며 Route/AI cache 본문과 Job 상태는 계속 Redis에 저장합니다. `POSTGRES_PASSWORD`는 빈 `postgres-data` volume을 최초 초기화할 때 적용되므로 운영 중 암호 변경은 PostgreSQL role 변경 절차와 함께 수행해야 합니다.

## URL 구조

| URL                                         | 용도                                          |
| ------------------------------------------- | --------------------------------------------- |
| `/`                                         | testbed 홈                                    |
| `/route`                                    | Multi-provider Route playground               |
| `/route/matrix`                             | directed Matrix Query testbed                 |
| `/route/jobs`                               | Route Job lifecycle testbed                   |
| `/route/cache`                              | Redis Route Cache read-only explorer          |
| `/route/analytics`                          | PostgreSQL Route Analytics dashboard          |
| `/ai`                                       | AI Job testbed                                |
| `/status`                                   | 배포 상태 UI                                  |
| `/health`                                   | server/container health check                 |
| `/api/route/ping`                           | Route Cache health                            |
| `POST /api/route/provider/google/compute`   | Google provider 직접 검증                     |
| `POST /api/route/jobs`                      | 비동기 Route Job 생성                         |
| `GET /api/route/jobs/:jobId`                | Route Job 상태 polling                        |
| `GET /api/route/jobs/:jobId/events`         | Route Job SSE progress stream                 |
| `GET /api/route/jobs/:jobId/result`         | 완료 결과 조회                                |
| `GET /api/route/providers/diagnostics`      | provider 설정·연결 상태(core health와 분리)   |
| `POST /api/route/jobs/:jobId/cancel`        | Route Job 취소                                |
| `POST /api/route/matrix/jobs`               | directed Travel Time Matrix Job 생성          |
| `GET /api/route/matrix/jobs/:jobId`         | Matrix Job 상태 polling                       |
| `GET /api/route/matrix/jobs/:jobId/events`  | Matrix Job SSE progress stream                |
| `GET /api/route/matrix/jobs/:jobId/result`  | 완료된 durationSeconds matrix 조회            |
| `POST /api/route/matrix/jobs/:jobId/cancel` | Matrix Job 취소                               |
| `GET /api/route/analytics/summary`          | Route 분석 요약                               |
| `GET /api/route/analytics/timeseries`       | 시간/일 단위 요청 추이                        |
| `GET /api/route/analytics/modes`            | 이동수단별 요청 및 cache hit rate             |
| `GET /api/route/analytics/top-routes`       | 요청량 기준 상위 출발지/도착지 조합           |
| `GET /api/route/analytics/errors`           | error code별 발생 건수                        |
| `GET /api/route/analytics/recent`           | 최근 Route 요청 metadata                      |
| `/api/ai/ping`                              | AI Cache health                               |
| `POST /api/ai/jobs`                         | 비동기 AI Job 생성                            |
| `GET /api/ai/jobs/:jobId`                   | AI Job 상태 polling                           |
| `GET /api/ai/jobs/:jobId/events`            | AI Job SSE progress stream                    |
| `GET /api/ai/jobs/:jobId/result`            | AI Job 완료 결과 조회                         |
| `POST /api/ai/jobs/:jobId/cancel`           | AI Job 취소                                   |
| `/api/status`                               | UI에서 server `/status`를 조회하는 proxy 경로 |

server의 `GET /status`는 service, commit SHA, environment, uptime, Redis 및 PostgreSQL 상태를 JSON으로 반환합니다. PostgreSQL 상태는 server가 주기적으로 실행하는 `SELECT 1` 결과를 캐시하므로 `/status` 요청마다 DB query를 실행하지 않습니다. 외부 `/status`는 같은 정보를 표시하는 React 화면이므로 Nginx/Vite가 `/api/status`를 server의 `/status`로 변환합니다.

## Google Routes Provider Debug API

`POST /api/route/provider/google/compute`는 Route Playground 전용 개발·검증 endpoint입니다. 요청 normalization 후 Google provider를 직접 호출하며 Job 저장, SSE, Redis result cache, PostgreSQL Analytics를 거치지 않습니다. 응답에는 normalized request와 Google request body, field mask, latency, normalized routes 및 raw Google response가 포함되고 API key는 포함되지 않습니다.

```bash
curl -X POST http://localhost:3200/api/route/provider/google/compute \
  -H 'Content-Type: application/json' \
  -d '{
    "locations":[
      {"address":"東京駅、日本"},
      {"address":"東京タワー、日本"}
    ],
    "mode":"DRIVING",
    "departureTime":"2026-10-02T14:23:00+09:00",
    "computeAlternativeRoutes":true
  }'
```

## Route Job API

Route 요청은 `202 Accepted`와 `route_` prefix Job ID를 즉시 반환하고 Redis에서 상태를 관리합니다. 클라이언트는 callback URL을 제공하지 않으며, 반환된 `eventsUrl`에 직접 SSE 연결을 열어 `snapshot`, `progress`, `completed`, `failed`, `cancelled` 이벤트를 받습니다. 연결이 끊겨도 Job은 계속 실행되며 재연결 시 최신 Redis snapshot이 먼저 전송됩니다.

외부 클라이언트는 방문 순서대로 정렬된 `locations`, `mode`, timezone이 포함된 `departureTime`만 전송하면 됩니다. 첫 위치는 출발지, 마지막 위치는 도착지, 그 사이는 경유지로 정규화됩니다. 위치는 2~27개이며 canonical 위치는 `coordinates.latitude` / `coordinates.longitude`를 기준으로 하고 provider별 ID는 `externalIds`에 둡니다. 주소도 지원하며 기존 `{ placeId }`, `{ latitude, longitude }`, `origin` / `intermediates` / `destination` / `travelMode` 형태는 호환을 위해 계속 지원합니다.

```bash
curl -X POST http://localhost:3200/api/route/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "locations":[
      {"coordinates":{"latitude":37.5665,"longitude":126.9780},"externalIds":{"googlePlaceId":"ChIJ-origin"}},
      {"coordinates":{"latitude":37.5700,"longitude":126.9820}},
      {"address":"서울역"}
    ],
    "mode":"TRANSIT",
    "countryCode":"JP",
    "departureTime":"2026-10-02T14:23:00+09:00",
    "languageCode":"ko"
  }'

curl -N http://localhost:3200/api/route/jobs/<jobId>/events
curl http://localhost:3200/api/route/jobs/<jobId>/result
```

로컬 `.env.example`은 실제 비용 없이 Job·cache·SSE 흐름을 검증하도록 `ROUTE_PROVIDER=mock`을 사용합니다. Compose 기본값인 `auto`는 `countryCode`와 mode로 provider를 선택합니다. JP TRANSIT은 `JAPAN_TRANSIT_PROVIDER`(기본 Ekispert), JP의 다른 mode는 Google, KR DRIVING은 Kakao Mobility, KR의 다른 mode는 Kakao Maps, 그 외 또는 국가 미지정 요청은 Google을 선택합니다. Kakao adapter는 WGS84 좌표가 있는 location만 받고, NAVITIME adapter는 `navitimeId` 또는 WGS84 좌표를 사용합니다. Ekispert adapter는 `ekispertId`, WGS84 좌표, 주소, 역명 순으로 실제 Standard 경로 탐색 API에 매핑합니다. 어느 adapter도 Google Place ID를 다른 provider ID로 전달하지 않습니다. provider 오류 시 자동 fallback하지 않습니다. production에서는 `ROUTE_PROVIDER_OVERRIDE_ENABLED=false`가 기본이며, provider는 Job 상태를 직접 다루지 않고 timeout과 progress stage는 runner가 관리합니다.

### Ekispert 일본 대중교통 provider

Ekispert adapter는 일본 `TRANSIT` 전용이며 공식 Standard API의 [`search/course/extreme`](https://docs.ekispert.com/v1/api/search/course/extreme.html)을 사용합니다. Free Plan의 `search/course/light`는 역·노선 조회 및 웹 URL 생성 중심으로 실제 경로 결과 JSON을 제공하는 RouteProvider API가 아니므로 사용하지 않습니다. Standard 또는 90일 평가판 access key를 `EKISPERT_API_KEY`에 설정해야 합니다.

평가판 key가 없거나 만료돼도 server와 provider registry는 정상 시작합니다. Catalog에는 Ekispert가 unavailable로 표시되고, 선택된 요청은 `PROVIDER_NOT_CONFIGURED`로 실패하며 NAVITIME으로 자동 fallback하지 않습니다. 평가 종료 후 `JAPAN_TRANSIT_PROVIDER=navitime`으로 명시적으로 전환하거나 Testbed의 `provider=ekispert` / `provider=navitime` override로 동일 요청 결과를 비교할 수 있습니다. 두 provider 결과는 각각 `route:v4:ekispert:...`, `route:v4:navitime:...` namespace를 사용합니다.

## Travel Time Matrix API

`POST /api/route/matrix/jobs`는 2~20개 location의 모든 directed pair를 계산합니다. 대각선은 provider를 호출하지 않고 0으로 채우며, 입력 순서를 결과에 그대로 보존합니다. 각 pair는 일반 Route Job과 동일한 cache key, TTL, provider adapter를 사용하므로 cache hit에서는 provider를 다시 호출하지 않습니다. 하나의 pair라도 실패하면 부분 matrix 대신 전체 Job이 실패합니다.

```sh
curl -X POST http://localhost:3200/api/route/matrix/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "locations":[
      {"id":"A","placeId":"ChIJ-origin"},
      {"id":"B","placeId":"ChIJ-destination"}
    ],
    "mode":"TRANSIT",
    "departureTime":"2026-10-01T09:00:00+09:00",
    "options":{"languageCode":"ko","regionCode":"KR"}
  }'
```

결과의 `durationSeconds`는 directed square matrix이며 단위는 항상 초입니다. `TCACHE_MATRIX_CONCURRENCY`로 pair 동시성을 제한하며 1 이상의 정수만 허용합니다.

Testbed의 Matrix Query preset은 troute의
`tests/fixtures/places/*_10_places.json`에서 생성합니다. Tokyo/Seoul 각각
3/5/10개 preset이 같은 Place ID와 순서를 사용하며, 화면에서 장소명·slug·Place ID와
tcache request 및 troute-compatible request preview를 확인할 수 있습니다. 생성 파일
`route/testbed/matrix/place-fixtures.generated.ts`는 직접 편집하지 않고 troute에서
`node scripts/generate_testbed_place_presets.mjs`를 실행해 갱신합니다. 자동 UI 테스트는
실제 Google provider를 호출하지 않습니다.

## OpenTripPlanner Tokyo PoC

`otp/`에는 tcache 런타임과 결합되지 않은 독립 OTP 2.10.0 실험 환경이 있습니다. Tokyo OSM과 라이선스가 확인된 Toei 정적 GTFS로 graph를 만들고 GTFS GraphQL `planConnection`을 통해 도보·대중교통 경로 및 latency를 검증합니다. 데이터 다운로드, graph build, 실행, query와 coverage 제한은 [OTP PoC README](otp/README.md)를 참고합니다.

### Experimental OTP RouteProvider

독립 PoC가 검증된 뒤 추가된 `otp` adapter는 좌표가 있는 `JP + TRANSIT` 요청만 받으며 GraphQL query와 variables를 분리해 `/otp/gtfs/v1`을 호출합니다. 기본 Japan transit 정책은 계속 Ekispert이고 OTP는 `OTP_PROVIDER_ENABLED=true`와 개발용 `provider=otp` override를 함께 설정해야 사용됩니다. 실패 시 Ekispert/NAVITIME으로 자동 fallback하지 않습니다.

실험용 Compose overlay는 production topology와 분리되어 있습니다. `otp/data/tokyo/graph.obj`를 먼저 만든 뒤 다음처럼 실행합니다.

```bash
docker compose -f docker-compose.yml -f docker-compose.otp.yml --profile otp up -d --build
```

컨테이너 안의 tcache server는 service DNS인 `http://otp:8080`을 사용합니다. OTP 장애는 `/health`나 core server health를 down으로 만들지 않으며, `GET /api/route/providers/diagnostics`에서 `configured`와 `reachable`을 별도로 확인합니다. Testbed override에서 Ekispert, NAVITIME, OpenTripPlanner를 같은 JP transit preset으로 실행해 duration, transfer, walking, latency와 cache hit/miss를 비교할 수 있습니다.

CI의 기본 test suite는 fixture HTTP 응답만 사용합니다. 로컬 graph까지 확인하려면 OTP를 실행한 뒤 `RUN_LIVE_ROUTE_PROVIDER_TESTS=true OTP_BASE_URL=http://127.0.0.1:8080 pnpm --filter @tcache/server exec vitest run route/server/otp-provider.test.ts --root ../..`를 실행합니다.

GTFS/OSM을 갱신한 뒤에는 graph를 다시 빌드하고 `OTP_GRAPH_BUILD_ID`를 새 값으로 바꿔야 합니다. 이 값과 dataset version은 `route:v4:otp:...` hash seed, cache metadata, normalized result metadata에 포함되므로 과거 graph 결과와 cache가 섞이지 않습니다. API 전체 응답은 debug 설정이 켜진 환경에서만 노출되며 endpoint, GraphQL variables, itinerary count와 dataset identity에는 secret이 포함되지 않습니다.

## AI Job API

AI 요청도 `202 Accepted`와 `ai_` prefix Job ID를 즉시 반환합니다. Redis가 상태의 source of truth이고 SSE 연결 종료와 Job 실행은 분리됩니다. 공개 Job 상태와 SSE에는 raw system prompt/message 대신 prompt hash, 메시지 수, option key 같은 metadata만 포함됩니다.

```bash
curl -X POST http://localhost:3200/api/ai/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "provider":"mock",
    "model":"mock-ai-v1",
    "systemPrompt":"You are a concise assistant.",
    "messages":[{"role":"user","content":"Summarize this request."}],
    "options":{"temperature":0.2},
    "cache":{"enabled":true}
  }'

curl -N http://localhost:3200/api/ai/jobs/<jobId>/events
curl http://localhost:3200/api/ai/jobs/<jobId>/result
```

로컬 `.env.example`은 `AI_PROVIDER=mock`을 사용합니다. Compose와 production의 기본 provider는 `gemini`이며 `GEMINI_API_KEY`가 없으면 mock으로 fallback하지 않고 Job이 `AI_PROVIDER_ERROR`로 실패합니다. 현재 Gemini REST provider와 mock provider가 구현되어 있고 provider registry를 통해 Qwen/OpenAI 구현을 독립적으로 추가할 수 있습니다. AI token streaming은 Job progress SSE와 분리된 후속 범위입니다.

## 배포 구조

```text
Internet → Cloudflare HTTPS/Tunnel → 127.0.0.1:3201
                                      └─ testbed Nginx
                                         ├─ React static files
                                         └─ /api, /health → tcache-server:3200
                                                               ├─ redis:6379
                                                               └─ postgres:5432
```

Cloudflare Tunnel 예시는 [`deploy/cloudflare`](deploy/cloudflare)에 있습니다. 실제 tunnel ID, token, JSON credential은 Mac mini의 저장소 외부에 보관합니다.

## GitHub Actions

PR과 `main` push에서 install, lint, typecheck, build, Fastify inject 테스트를 실행합니다. `main`의 CI가 성공하면 `[self-hosted, macOS]` runner가 이미지를 먼저 빌드하고 Compose 서비스를 갱신한 뒤 `/health`를 검증합니다. 빌드 실패 시 실행 중인 컨테이너는 교체되지 않습니다.

배포 job은 GitHub `production` Environment와 `https://tcache.mangagaki.net` URL을 사용하므로 GitHub Deployments 화면에서 진행/성공/실패 상태를 확인할 수 있습니다. `${{ github.sha }}`는 `GIT_COMMIT_SHA`로 주입되어 testbed의 `/status`에서 실제 배포 버전을 확인할 수 있습니다.

Mac mini에는 다음 사전 구성이 필요합니다.

1. GitHub self-hosted runner에 `macOS` label과 Docker 접근 권한 설정
2. repository Environment `production` 생성
3. 필요하면 Actions variable `TCACHE_PORT` 설정(기본 `3200`)
4. production Environment에 `ROUTE_PROVIDER=auto`, `AI_PROVIDER=gemini` variable 설정
5. production Environment에 `POSTGRES_PASSWORD`, `DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `KAKAO_REST_API_KEY`, `KAKAO_MOBILITY_API_KEY`, `EKISPERT_API_KEY`, `NAVITIME_API_KEY`, `GEMINI_API_KEY` secret 설정
6. `DATABASE_URL`은 Docker DNS의 `postgres:5432`와 URL-encoded password를 사용하도록 설정
7. `cloudflared`를 시스템 서비스로 등록하고 `tcache.mangagaki.net` 연결

## PostgreSQL 수동 백업과 복원

PostgreSQL의 database/user는 모두 `tcache`이고 데이터 디렉터리는 Compose의 `postgres-data` volume에서 `/var/lib/postgresql/data`로 mount됩니다. 별도 원격 자동 백업을 붙이기 전에는 다음 명령으로 custom-format dump를 만들 수 있습니다.

```bash
docker compose exec -T postgres pg_dump -U tcache -d tcache -Fc > tcache.dump
```

복원 전에는 현재 DB를 별도로 백업하고 tcache-server를 중지해 쓰기를 차단합니다. 아래 `--clean` 복원은 기존 DB object를 교체합니다.

```bash
docker compose stop tcache-server
docker compose exec -T postgres pg_restore \
  -U tcache -d tcache --clean --if-exists < tcache.dump
docker compose start tcache-server
```

## PostgreSQL migration

명시적 SQL migration은 `apps/server/src/db/migrations`에 버전 순서대로 보관합니다. server는 Redis 연결 후, HTTP listen 전에 migration을 transaction과 PostgreSQL advisory lock 안에서 적용합니다. 적용된 버전과 SHA-256 checksum은 `schema_migrations`에 기록되며, 이미 적용한 파일이 변경되었거나 migration이 실패하면 server가 시작되지 않아 배포 health check도 실패합니다. `DROP`/`TRUNCATE` 계열 destructive SQL은 runner가 거부합니다.

최초 migration은 장기 분석용 `route_requests`와 `created_at`, `mode`, `cache_hit`, `provider`, `status` index를 생성합니다. Route/AI cache 본문과 Job 실시간 상태는 PostgreSQL에 저장하지 않습니다. Route Job은 시작 시 분석 row를 upsert하고 completed/failed/cancelled 시 cache 결과, latency, 상태와 제한된 error code를 갱신합니다. recorder 실패는 구조화된 warning으로 남지만 Route 결과에는 영향을 주지 않으며 Job runner는 SQL 세부사항에 의존하지 않습니다.

Route cache key와 분석 metadata는 `route/server/cache/canonical.ts`의 location canonicalization, day type, 10분 time bucket을 함께 사용합니다. 좌표를 우선하는 cache key는 `route:v4:<provider>:<mode>:<country>:<hash>` 형태이며 provider별 결과를 공유하지 않습니다. 좌표 정밀도는 `ROUTE_COORDINATE_PRECISION` 상수로 제한합니다. timezone은 요청의 `timeZone`, 국가 기본값(`JP`는 `Asia/Tokyo`, `KR`은 `Asia/Seoul`), `ROUTE_TIME_ZONE` 순서로 결정합니다. 새 cache entry에는 provider/version, normalized request hash, 생성·만료 시각이 저장되며 기존 namespace를 dual-read하지 않습니다. holiday 판정 hook은 준비되어 있지만 기본 정책에서는 weekday/saturday/sunday만 계산합니다.

Route Analytics API는 조회 전용이며 기본 조회 기간은 최근 24시간, 최대 조회 기간은 90일입니다. `from`/`to`는 ISO-8601, `interval`은 `hour` 또는 `day`를 사용합니다. Top Routes limit은 최대 100, Recent Requests limit은 최대 200입니다. 집계는 PostgreSQL의 `COUNT`, `AVG`, `FILTER`, `GROUP BY`, `date_trunc`로 수행하며 별도 Redis cache를 사용하지 않습니다.

Testbed의 `/route`는 기존 Jobs 화면과 Analytics 탭을 함께 제공합니다. Analytics 탭은 최근 24시간/7일/30일 preset, mode/provider/status filter, 수동 refresh, summary, SVG/CSS 기반 추이 chart, mode breakdown, Top Routes/Recent Requests/Error 표를 표시합니다. Recent Requests의 Job ID를 선택하면 기존 Jobs 상세 화면으로 이동합니다.

임의의 격리 DB에 migration만 실행하려면 해당 DB의 연결 문자열을 지정합니다. 같은 명령을 다시 실행해도 적용된 version은 건너뜁니다.

```bash
DATABASE_URL=postgresql://tcache:password@127.0.0.1:5432/tcache \
  pnpm --filter @tcache/server db:migrate
```

## 현재 범위

현재 Route Cache와 AI Cache는 각각 독립된 Redis-backed 비동기 Job, SSE progress, polling/result/cancel API, 결과 cache와 Job testbed를 제공합니다. PostgreSQL은 연결, 영속 volume, health monitoring, migration 및 Route 요청 분석 이력을 담당합니다. Route는 Google/mock provider, AI는 Gemini/mock provider를 지원합니다. Bloom Filter, 인증, 고급 eviction, token streaming, 통계 dashboard는 후속 작업 범위입니다.
