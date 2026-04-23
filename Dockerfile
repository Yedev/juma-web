# ── Stage 1: Build frontend ──────────────────────────────
FROM node:22-alpine AS build-frontend

WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

# ── Stage 2: Build backend ───────────────────────────────
FROM node:22-alpine AS build-backend

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npx tsc

# ── Stage 3: Production ─────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate

COPY --from=build-backend /app/server/dist ./dist
COPY --from=build-frontend /app/admin-ui/dist ./public

COPY server/src/prisma/seed.ts ./seed.ts

ENV NODE_ENV=production
ENV PORT=3001
ENV LOG_DIR=/app/logs

EXPOSE 3001

VOLUME ["/app/data", "/app/logs"]

CMD sh -c "\
  cp -n /app/prisma/schema.prisma /app/data/schema.prisma 2>/dev/null; \
  DATABASE_URL=file:/app/data/juma.db npx prisma db push --schema=/app/prisma/schema.prisma --skip-generate && \
  DATABASE_URL=file:/app/data/juma.db npx tsx seed.ts && \
  DATABASE_URL=file:/app/data/juma.db node dist/index.js"
