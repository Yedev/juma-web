# AGENTS.md

## Cursor Cloud specific instructions

- **Repository**: `juma-web` — full-stack admin management system for a mobile app.
- **Tech stack**: Express + TypeScript + Prisma + SQLite (backend), Vite + React + TypeScript + Ant Design (frontend).
- **Project structure**: `server/` (backend on port 3001), `admin-ui/` (frontend on port 5173).

### Running services

1. **Backend**: `cd server && npm run dev` (runs on port 3001, hot-reload via tsx watch)
2. **Frontend**: `cd admin-ui && npm run dev` (runs on port 5173, Vite dev server with API proxy to :3001)
3. **Database**: SQLite at `server/prisma/dev.db`, auto-created on first `prisma db push`.

### First-time setup after fresh clone

```bash
cd server && npm install && npx prisma generate && npx prisma db push && npm run db:seed
cd ../admin-ui && npm install
```

### Key gotchas

- The frontend Vite config proxies `/api` requests to `http://localhost:3001`, so the backend must be running for the frontend to work.
- Default login credentials: username `juma`, password `juma2026`.
- Mobile APIs at `/api/v1/app/*` require `x-timestamp` and `x-sign` headers (MD5 signature). The API Playground page auto-generates these.
- `APP_SECRET` for signing: `juma2026_secret`.

### Standard commands

| Task | Backend (`server/`) | Frontend (`admin-ui/`) |
|------|--------------------|-----------------------|
| Dev  | `npm run dev`      | `npm run dev`         |
| Build| `npm run build`    | `npx vite build`      |
| Lint | `npm run lint`     | `npx eslint src/`     |
| TypeScript check | `npx tsc --noEmit` | `npx tsc --noEmit` |
