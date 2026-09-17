FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/testbed/package.json apps/testbed/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --frozen-lockfile

COPY apps/testbed apps/testbed
COPY ai/testbed ai/testbed
COPY route/testbed route/testbed
COPY packages/common packages/common
RUN pnpm --filter @tcache/testbed build

FROM nginx:1.29-alpine AS runtime

COPY deploy/docker/testbed.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/testbed/dist /usr/share/nginx/html

EXPOSE 80
