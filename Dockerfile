# syntax=docker/dockerfile:1
FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/fineants.db MIGRATIONS_DIR=/app/migrations
RUN groupadd -r fineants && useradd -r -g fineants -d /app fineants && mkdir -p /data && chown fineants:fineants /data
COPY --from=build --chown=fineants:fineants /app/.next/standalone ./
COPY --from=build --chown=fineants:fineants /app/.next/static ./.next/static
COPY --from=build --chown=fineants:fineants /app/public ./public
COPY --from=build --chown=fineants:fineants /app/src/lib/db/migrations ./migrations
# No USER line on purpose: the entrypoint starts as root so it can make a host-owned
# ./data bind mount writable, then drops to fineants with setpriv (util-linux, already
# in node:24-slim) before exec'ing the CMD. Adding `user:` to compose would pre-empt it.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
