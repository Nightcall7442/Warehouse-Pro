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
# Ключ Яндекс.Карт. Не секрет — он уходит в браузер вместе с бандлом в любом
# случае, и защищён на стороне Яндекса списком разрешённых доменов. Но раз в
# коде уже стоит чтение переменной, она должна работать: без этой строки Vite
# её не видит, подставляется запасное значение из исходника, и сменить ключ
# без правки кода нельзя.
ARG VITE_YANDEX_MAPS_API_KEY=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SENTRY_PROJECT=${SENTRY_PROJECT}
ENV VITE_YANDEX_MAPS_API_KEY=${VITE_YANDEX_MAPS_API_KEY}

ENV NODE_ENV=production
RUN npm run build

FROM base AS runtime
WORKDIR /app
# mysqldump — needed by api/cron/backup.ts to produce real, restorable backups
RUN apk add --no-cache mysql-client
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
# Source maps were already uploaded to Sentry during the build stage — they are
# ~10 MB of publicly served files that no browser requests.
RUN find ./dist -name "*.map" -delete
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
# Migrations run inside boot.js (see api/boot.ts). Keeping them out of the
# start command means a platform-level startCommand override — railway.json
# sets one — can no longer drop them silently, which is how production ended
# up several migrations behind its code.
CMD ["node", "dist/boot.js"]
