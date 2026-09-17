FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/common packages/common
RUN pnpm --filter @tcache/server... build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/common/package.json ./packages/common/package.json
COPY --from=build /app/packages/common/dist ./packages/common/dist

USER node
EXPOSE 3200
CMD ["node", "apps/server/dist/index.js"]
