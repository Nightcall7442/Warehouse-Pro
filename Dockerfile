FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json ./
COPY vite.config.ts vitest.config.ts eslint.config.js postcss.config.js tailwind.config.js drizzle.config.ts index.html ./
COPY api/ api/
COPY db/ db/
COPY contracts/ contracts/
COPY src/ src/
COPY public/ public/
COPY .env.example .env

# Build-time env vars — Vite inlines these at bundle time.
# Railway: set these in Project → Settings → Variables (they're passed to docker build).
ARG VITE_SENTRY_DSN=""
ARG VITE_APP_VERSION=""
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SENTRY_PROJECT=${SENTRY_PROJECT}

ENV NODE_ENV=production
RUN npm run build

FROM base AS runtime
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=builder --chown=appuser:appgroup /app/db ./db
COPY --from=builder --chown=appuser:appgroup /app/drizzle.config.ts ./
USER appuser
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
# Install drizzle-kit, run migrations, then start server
CMD ["sh", "-c", "npm install drizzle-kit --no-save --legacy-peer-deps && npx drizzle-kit migrate && node dist/boot.js"]
