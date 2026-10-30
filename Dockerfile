FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN JWT_SECRET=build-only-placeholder-not-a-runtime-secret \
    DB_HOST=127.0.0.1 DB_PORT=1 DB_USER=build DB_PASSWORD=build DB_NAME=build \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    npm run build
RUN node scripts/build-background-jobs.mjs

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf .next/standalone/node_modules

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
COPY --from=production-dependencies --chown=node:node /app/.next/standalone ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist/backend/background-jobs.cjs ./background-jobs.cjs
COPY --from=build --chown=node:node /app/scripts/check-background-runtime.cjs ./check-background-runtime.cjs
RUN node check-background-runtime.cjs ./background-jobs.cjs \
    && rm check-background-runtime.cjs
USER node
EXPOSE 8080
CMD ["node", "server.js"]
