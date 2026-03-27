# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

juma-web is a full-stack TypeScript application with two core modules:
1. **Admin Management System** - Task scheduling, remote executor dispatch, app configuration for mobile apps
2. **DeepRead Platform** - Content reading platform with spaces, channels, articles, collections, and AI integration

Tech stack: Express + TypeScript + Prisma + SQLite (backend), Vite + React 19 + TypeScript + Ant Design 6 (frontend).

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

No test framework is configured. There are no automated tests.

## Architecture

### Three Independent Packages (no monorepo tooling)

- **`server/`** - Express backend on port 3001
- **`admin-ui/`** - React frontend on port 5173 (Vite proxies `/api` to `:3001`)
- **`mac-mini-client/`** - Plain JS WebSocket executor client (no build step)

### Server Route Structure

Routes are mounted in `server/src/index.ts`:

- `/api/auth` → `routes/auth.ts` - Admin login/register
- `/api/admin` → `routes/admin.ts` - Admin management (JWT-protected)
- `/api/v1/app` → `routes/app.ts` - Mobile app APIs (x-sign protected)
- `/api/v1/dr` → `routes/deepread.ts` - DeepRead client APIs (x-sign + optional JWT)
- `/ws/executor` - WebSocket gateway for remote task executors

### Authentication (three strategies)

1. **Admin endpoints** (`/api/admin`): JWT Bearer token via `middleware/auth.ts`
2. **Mobile app endpoints** (`/api/v1/app`): MD5 signature (`x-sign` = MD5(APP_SECRET + x-timestamp)) via `middleware/sign.ts`
3. **DeepRead endpoints** (`/api/v1/dr`): MD5 signature + optional JWT via `middleware/drAuth.ts`

### Task Execution System

Tasks are split by naming prefix:
- `server.*` tasks execute locally via `services/executionEngine.ts`
- `client.*` tasks are dispatched via WebSocket to remote executors (`ws/executorWsGateway.ts`)

Task definitions live in `services/taskRegistry.ts`. The lifecycle is: `queued → running → completed|error`.

### Database

Prisma ORM with SQLite. Schema at `server/prisma/schema.prisma`, dev database at `server/dev.db`.

Key model groups:
- Admin: `AdminUser`, `AppConfig`, `Task`, `ExecutorClient`
- DeepRead: `DrUser`, `DrSpace`, `DrSpaceMember`, `DrChannel`, `DrArticle`, `DrCollection`, `DrBookmark`, `DrReadStatus`, `DrHighlight`, `DrSpaceHomepageModule`

### Frontend Structure

- Entry: `admin-ui/src/App.tsx` (React Router v7 routes)
- Layout: `layouts/AdminLayout.tsx` (sidebar + content)
- API client: `api/client.ts` (Axios with JWT interceptor, auto-logout on 401)
- Pages in `pages/` follow the pattern `Dr*Management.tsx` for DeepRead modules

## Key Gotchas

- The frontend Vite dev server proxies `/api` to `http://localhost:3001` - backend must be running.
- Default admin credentials: `juma` / `juma2026`. DeepRead test user: `13800138000` / `888888`.
- All `/api/v1/*` endpoints require `x-timestamp` and `x-sign` headers. The Admin UI's API Playground page auto-generates these.
- `APP_SECRET` for signing: `juma2026_secret`.
