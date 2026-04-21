# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

juma-web is a full-stack TypeScript application with two core modules:
1. **Admin Management System** - Task scheduling, remote executor dispatch, app configuration for mobile apps
2. **DeepRead Platform** - Content reading platform with spaces, channels, articles, collections, and AI integration

Tech stack: Express + TypeScript + Prisma + SQLite + Redis (backend), Vite + React 19 + TypeScript + Ant Design 6 (frontend).

## Development Commands

### Backend (`server/`)

| Task | Command |
|------|---------|
| Dev server (port 3001) | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` |
| Generate Prisma client | `npm run db:generate` |
| Push schema to DB | `npm run db:push` |
| Seed database | `npm run db:seed` |

### Frontend (`admin-ui/`)

| Task | Command |
|------|---------|
| Dev server (port 5173) | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` |

### First-time Setup

```bash
cd server && npm install && npx prisma generate && npx prisma db push && npm run db:seed
cd ../admin-ui && npm install
```

Redis is optional but recommended. Start locally with `docker run -d -p 6379:6379 redis:alpine` or set `REDIS_URL`. The server gracefully falls back to DB-only mode when Redis is unavailable.

No test framework is configured. There are no automated tests.

## Architecture

### Three Independent Packages (no monorepo tooling)

- **`server/`** - Express backend on port 3001
- **`admin-ui/`** - React frontend on port 5173 (Vite proxies `/api` to `:3001`)
- **`mac-mini-client/`** - Plain JS WebSocket executor client (no build step)

### Server Route Structure

Routes are mounted in `server/src/app.ts`:

- `/api/auth` → `routes/auth.ts` - Admin login/register
- `/api/admin` → `routes/admin.ts` - Admin management (JWT-protected)
- `/api/v1/app` → `routes/app.ts` - Mobile app APIs (x-sign protected)
- `/api/v1/analytics` → `routes/analytics.ts` - Analytics event reporting (x-sign protected)
- `/api/v1/dr` → `routes/deepread.ts` - DeepRead client APIs (x-sign + optional JWT), aggregates sub-routes from `routes/dr/`:
  - `dr/auth.ts` - SMS login
  - `dr/articles.ts` - Article listing/detail
  - `dr/highlights.ts` - Highlight CRUD
  - `dr/collections.ts` - User collections
  - `dr/homepage.ts` - Space homepage & daily article
  - `dr/sync.ts` - Data export/import
  - `dr/ai.ts` - AI chat (normal + SSE stream)
- `/ws/executor` - WebSocket gateway for remote task executors

### Authentication (three strategies)

1. **Admin endpoints** (`/api/admin`): JWT Bearer token via `middleware/auth.ts`
2. **Mobile app endpoints** (`/api/v1/app`): MD5 signature (`x-sign` = MD5(APP_SECRET + x-timestamp)) via `middleware/sign.ts`
3. **DeepRead endpoints** (`/api/v1/dr`): MD5 signature + optional JWT via `middleware/drAuth.ts`
4. **Analytics endpoints** (`/api/v1/analytics`): x-sign protected via `middleware/sign.ts`

### Task Execution System

Tasks are split by naming prefix:
- `server.*` tasks execute locally via `services/executionEngine.ts`
- `client.*` tasks are dispatched via WebSocket to remote executors (`ws/executorWsGateway.ts`)

Task definitions live in `services/taskRegistry.ts`. The lifecycle is: `queued → running → completed|error`.

### Database

Prisma ORM with SQLite. Schema at `server/prisma/schema.prisma`, dev database at `server/dev.db`. **28 models** total.

Key model groups:
- Admin: `AdminUser`, `AppConfig`, `Task`, `ExecutorClient`, `AnalyticsEvent`
- DeepRead Core: `DrUser`, `DrSmsCode`, `DrSpace`, `DrSpaceMember`, `DrInviteCode`, `DrChannel`, `DrArticle`, `DrHighlight`, `DrReadingStats`
- DeepRead Collections: `DrCollection`, `DrCollectionArticle`, `DrSpaceCollection`, `DrSpaceCollectionArticle`
- DeepRead Homepage: `DrSpaceHomepageModule`, `DrSpaceHomepageModuleResource`, `DrDailyPickLattice`, `DrDailyPickArticle`
- DeepRead AI: `DrAiProvider`, `DrAiModel`, `DrAiQuota`, `DrAiUsage`
- DeepRead Editor: `DrEditorHighlight`
- DeepRead Sync: `DrSyncBackup`

### Redis Cache Layer

Redis client at `server/src/lib/redis.ts` (ioredis singleton, graceful fallback). SQLite remains source of truth; Redis is read-acceleration only.

| Scenario | Key Pattern | TTL | Module |
|----------|-------------|-----|--------|
| SMS verification code | `sms:code:{phone}` | 300s | `drAuthService.ts` |
| AppConfig cache | `config:{key}` | 60s | `lib/configCache.ts` |
| AI daily usage | `ai:usage:{userId}:{date}` | until midnight CST | `drAiService.ts` |
| AI provider config | `ai:provider:{name}` | 300s | `drAiService.ts` |
| AI model config | `ai:model:{providerId}:{model}` | 300s | `drAiService.ts` |
| Homepage modules | `homepage:modules:{spaceId}` | 300s | `drHomepageService.ts` |
| Rate limiting | `ratelimit:{prefix}:{key}` | 60s | `middleware/rateLimit.ts` |
| Executor heartbeat | `executor:heartbeat:{clientId}` | 70s | `ws/executorWsGateway.ts` |

### Background Tasks (node-cron)

Started in `server/src/index.ts` on server boot:

| Task | Interval | File |
|------|----------|------|
| Invite code cleanup | Hourly | `services/inviteCodeCleaner.ts` |
| Analytics event cleanup | Daily | `services/analyticsEventCleaner.ts` |
| SQLite DB backup to Aliyun OSS | Daily | `services/dbBackupToOss.ts` |

### Image Hosting

Uploaded images are stored on **Aliyun OSS** (configured via `OSS_*` env vars). OSS client at `server/src/lib/oss.ts`. Admin upload endpoint in `routes/admin.ts`. Falls back to error if OSS is not configured.

Cache invalidation: admin routes delete relevant keys on write. All keys auto-expire via TTL.

### Frontend Structure

- Entry: `admin-ui/src/App.tsx` (React Router v7 routes)
- Layout: `layouts/AdminLayout.tsx` (sidebar + content)
- API client: `api/client.ts` (Axios with JWT interceptor, auto-logout on 401)
- Pages in `pages/`:
  - Routed pages (registered in `App.tsx`): `Login`, `TaskManagement`, `ConfigManagement`, `DrSpaceManagement`, `DrSpaceDetail`, `DrUserManagement`, `DrAiConfigTabs`, `AnalyticsEventManagement`, `ImageHosting` (route: `/media`)
  - Sub-components (imported by routed pages): `DrAiConfig`, `DrAiQuotaManagement` (tabs inside `DrAiConfigTabs`)
  - Unreferenced page files (exist but never imported): `ApiPlayground`, `DrChannelManagement`, `DrArticleManagement`, `DrCollectionManagement`, `DrDailyPicksManagement`

## Key Gotchas

- The frontend Vite dev server proxies `/api` to `http://localhost:3001` - backend must be running.
- Default admin credentials: `juma` / `juma2026`. DeepRead test user: `13800138000` / `888888`.
- All `/api/v1/*` endpoints require `x-timestamp` and `x-sign` headers. The Admin UI's API Playground page auto-generates these.
- `APP_SECRET` for signing: `juma2026_secret`.
- `REDIS_URL` defaults to `redis://localhost:6379`. Server works without Redis (falls back to DB).
