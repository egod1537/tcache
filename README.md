# tcache

Trasolve와 troute에서 공용으로 사용하는 캐시 서버의 기반 프로젝트입니다. 현재 단계는 실제 캐시 정책이나 외부 API 연동이 아닌, Route Cache와 AI Response Cache를 독립적으로 개발하고 배포할 수 있는 실행 환경을 제공합니다.

## 구조와 분리 원칙

```text
apps/
├── server/src/
│   ├── route-cache/  # Route Cache 전용 영역
│   ├── ai-cache/     # AI Response Cache 전용 영역
│   ├── health/       # health/status API
│   └── redis/        # 공용 인프라
└── testbed/src/
    ├── route/        # Route Cache testbed
    ├── ai/           # AI Cache testbed
    └── common/       # testbed 공용 UI/HTTP 코드
packages/common/      # 실제로 범용적인 공유 타입
deploy/
├── docker/           # 컨테이너 이미지와 Nginx 설정
└── cloudflare/       # Cloudflare Tunnel 예시 및 문서
```

`route-cache`와 `ai-cache`는 서로의 내부 구현을 import하지 않습니다. 공유 코드는 Redis client, config, logger, health/HTTP utility, 범용 타입 같은 인프라 계층으로 제한합니다. 이 경계를 유지하면 향후 각 시스템을 별도 프로세스나 컨테이너로 분리할 수 있습니다.

## 기술 스택

- Server: Node.js 22, TypeScript, Fastify, Redis
- Testbed: React, Vite, TypeScript, Nginx
- Workspace: pnpm
- Infra: Docker Compose, Cloudflare Tunnel
- Quality: ESLint, Prettier, Vitest
- Deploy: GitHub Actions, macOS self-hosted runner

## 로컬 실행

Node.js 22 이상과 pnpm 10이 필요합니다. Redis를 로컬 `6379` 포트에서 실행한 뒤 아래 명령을 사용합니다.

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

Compose는 `tcache-server`, `tcache-testbed`, `redis`를 실행합니다. server와 testbed는 loopback에만 bind되고 Redis 포트는 host에 publish되지 않습니다. Redis 데이터는 `redis-data` volume에 저장됩니다.

## 환경 변수

| 변수                           | 기본값                   | 설명                          |
| ------------------------------ | ------------------------ | ----------------------------- |
| `NODE_ENV`                     | `development`            | 실행 환경                     |
| `TCACHE_PORT`                  | `3200`                   | 로컬 server/host 포트         |
| `TCACHE_TESTBED_PORT`          | `3201`                   | 로컬 testbed/host 포트        |
| `REDIS_URL`                    | `redis://localhost:6379` | Redis 연결 주소               |
| `GIT_COMMIT_SHA`               | `dev`                    | `/status`에 노출할 배포 버전  |
| `ROUTE_JOB_TTL_SECONDS`        | `86400`                  | Route Job 기록 보존 시간      |
| `ROUTE_CACHE_TTL_SECONDS`      | `3600`                   | Route 결과 cache TTL          |
| `ROUTE_PROVIDER_TIMEOUT_MS`    | `30000`                  | Route provider 요청 제한 시간 |
| `ROUTE_PROVIDER`               | `mock`                   | `mock` 또는 `google`          |
| `GOOGLE_MAPS_API_KEY`          | 비어 있음                | Google Routes API key         |
| `AI_JOB_TTL_SECONDS`           | `86400`                  | AI Job 기록 보존 시간         |
| `AI_CACHE_DEFAULT_TTL_SECONDS` | `3600`                   | AI 응답 cache TTL             |
| `AI_PROVIDER_TIMEOUT_MS`       | `120000`                 | AI provider 요청 제한 시간    |
| `AI_PROVIDER`                  | `mock`                   | `mock` 또는 `gemini`          |
| `GEMINI_API_KEY`               | 비어 있음                | Gemini API key                |

`.env`와 tunnel credential은 Git에 커밋하지 않습니다. Docker 환경에서는 server가 내부 주소 `redis://redis:6379`를 사용합니다.

## URL 구조

| URL                                  | 용도                                          |
| ------------------------------------ | --------------------------------------------- |
| `/`                                  | testbed 홈                                    |
| `/route`                             | Route Job testbed                             |
| `/ai`                                | AI Job testbed                                |
| `/status`                            | 배포 상태 UI                                  |
| `/health`                            | server/container health check                 |
| `/api/route/ping`                    | Route Cache health                            |
| `POST /api/route/jobs`               | 비동기 Route Job 생성                         |
| `GET /api/route/jobs/:jobId`         | Route Job 상태 polling                        |
| `GET /api/route/jobs/:jobId/events`  | Route Job SSE progress stream                 |
| `GET /api/route/jobs/:jobId/result`  | 완료 결과 조회                                |
| `POST /api/route/jobs/:jobId/cancel` | Route Job 취소                                |
| `/api/ai/ping`                       | AI Cache health                               |
| `POST /api/ai/jobs`                  | 비동기 AI Job 생성                            |
| `GET /api/ai/jobs/:jobId`            | AI Job 상태 polling                           |
| `GET /api/ai/jobs/:jobId/events`     | AI Job SSE progress stream                    |
| `GET /api/ai/jobs/:jobId/result`     | AI Job 완료 결과 조회                         |
| `POST /api/ai/jobs/:jobId/cancel`    | AI Job 취소                                   |
| `/api/status`                        | UI에서 server `/status`를 조회하는 proxy 경로 |

server의 `GET /status`는 service, commit SHA, environment, uptime, Redis 상태를 JSON으로 반환합니다. 외부 `/status`는 같은 정보를 표시하는 React 화면이므로 Nginx/Vite가 `/api/status`를 server의 `/status`로 변환합니다.

## Route Job API

Route 요청은 `202 Accepted`와 `route_` prefix Job ID를 즉시 반환하고 Redis에서 상태를 관리합니다. 클라이언트는 callback URL을 제공하지 않으며, 반환된 `eventsUrl`에 직접 SSE 연결을 열어 `snapshot`, `progress`, `completed`, `failed`, `cancelled` 이벤트를 받습니다. 연결이 끊겨도 Job은 계속 실행되며 재연결 시 최신 Redis snapshot이 먼저 전송됩니다.

```bash
curl -X POST http://localhost:3200/api/route/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "origin":{"address":"Seoul Station"},
    "destination":{"address":"Gangnam Station"},
    "waypoints":[],
    "travelMode":"TRANSIT",
    "options":{"languageCode":"ko"}
  }'

curl -N http://localhost:3200/api/route/jobs/<jobId>/events
curl http://localhost:3200/api/route/jobs/<jobId>/result
```

로컬 `.env.example`은 실제 비용 없이 Job·cache·SSE 흐름을 검증하도록 `ROUTE_PROVIDER=mock`을 사용합니다. Compose의 환경 변수 기본값은 운영 안전을 위해 `google`이며, 이때 `GOOGLE_MAPS_API_KEY`가 없으면 가짜 결과를 반환하지 않고 Job이 `PROVIDER_ERROR`로 실패합니다. provider는 Job 상태를 직접 다루지 않으며 timeout과 progress stage는 runner가 관리합니다.

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
                                                               └─ redis:6379
```

Cloudflare Tunnel 예시는 [`deploy/cloudflare`](deploy/cloudflare)에 있습니다. 실제 tunnel ID, token, JSON credential은 Mac mini의 저장소 외부에 보관합니다.

## GitHub Actions

PR과 `main` push에서 install, lint, typecheck, build, Fastify inject 테스트를 실행합니다. `main`의 CI가 성공하면 `[self-hosted, macOS]` runner가 이미지를 먼저 빌드하고 Compose 서비스를 갱신한 뒤 `/health`를 검증합니다. 빌드 실패 시 실행 중인 컨테이너는 교체되지 않습니다.

배포 job은 GitHub `production` Environment와 `https://tcache.mangagaki.net` URL을 사용하므로 GitHub Deployments 화면에서 진행/성공/실패 상태를 확인할 수 있습니다. `${{ github.sha }}`는 `GIT_COMMIT_SHA`로 주입되어 testbed의 `/status`에서 실제 배포 버전을 확인할 수 있습니다.

Mac mini에는 다음 사전 구성이 필요합니다.

1. GitHub self-hosted runner에 `macOS` label과 Docker 접근 권한 설정
2. repository Environment `production` 생성
3. 필요하면 Actions variable `TCACHE_PORT` 설정(기본 `3200`)
4. production Environment에 `ROUTE_PROVIDER=google`, `AI_PROVIDER=gemini` variable 설정
5. production Environment에 `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY` secret 설정
6. `cloudflared`를 시스템 서비스로 등록하고 `tcache.mangagaki.net` 연결

## 현재 범위

현재 Route Cache와 AI Cache는 각각 독립된 Redis-backed 비동기 Job, SSE progress, polling/result/cancel API, 결과 cache와 Job testbed를 제공합니다. Route는 Google/mock provider, AI는 Gemini/mock provider를 지원합니다. Bloom Filter, 인증, 고급 eviction, token streaming, 통계 dashboard는 후속 작업 범위입니다.
