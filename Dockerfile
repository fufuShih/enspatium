# syntax=docker/dockerfile:1
FROM node:24-bookworm AS dependencies
WORKDIR /app
RUN npm install --global pnpm@12.0.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/package.json
COPY apps/web/package.json apps/web/package.json

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/server packages/server
COPY apps/web apps/web
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm install --prod --filter @enspatium/server --frozen-lockfile

FROM node:24-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown node:node /data
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/packages/server/node_modules ./packages/server/node_modules
COPY packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY packages/server/src/db/migrations ./packages/server/dist/db/migrations
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_ROOT=/data SESSION_SECURE=true
USER node
EXPOSE 3000
CMD ["node", "packages/server/dist/main.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
