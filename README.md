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

| 변수                  | 기본값                   | 설명                         |
| --------------------- | ------------------------ | ---------------------------- |
| `NODE_ENV`            | `development`            | 실행 환경                    |
| `TCACHE_PORT`         | `3200`                   | 로컬 server/host 포트        |
| `TCACHE_TESTBED_PORT` | `3201`                   | 로컬 testbed/host 포트       |
| `REDIS_URL`           | `redis://localhost:6379` | Redis 연결 주소              |
| `GIT_COMMIT_SHA`      | `dev`                    | `/status`에 노출할 배포 버전 |
| `GOOGLE_MAPS_API_KEY` | 비어 있음                | 향후 Route Cache용           |
| `GEMINI_API_KEY`      | 비어 있음                | 향후 AI Cache용              |

`.env`와 tunnel credential은 Git에 커밋하지 않습니다. Docker 환경에서는 server가 내부 주소 `redis://redis:6379`를 사용합니다.

## URL 구조

| URL               | 용도                                          |
| ----------------- | --------------------------------------------- |
| `/`               | testbed 홈                                    |
| `/route`          | Route Cache testbed                           |
| `/ai`             | AI Cache testbed                              |
| `/status`         | 배포 상태 UI                                  |
| `/health`         | server/container health check                 |
| `/api/route/ping` | Route Cache placeholder API                   |
| `/api/ai/ping`    | AI Cache placeholder API                      |
| `/api/status`     | UI에서 server `/status`를 조회하는 proxy 경로 |

server의 `GET /status`는 service, commit SHA, environment, uptime, Redis 상태를 JSON으로 반환합니다. 외부 `/status`는 같은 정보를 표시하는 React 화면이므로 Nginx/Vite가 `/api/status`를 server의 `/status`로 변환합니다.

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
4. `cloudflared`를 시스템 서비스로 등록하고 `tcache.mangagaki.net` 연결

## 현재 범위

현재는 health/status와 Route/AI ping endpoint, placeholder testbed만 제공합니다. 실제 Maps/AI provider 연동, cache key와 TTL 정책, Bloom Filter, 인증, 고급 eviction, 통계 dashboard는 후속 작업 범위입니다.
