# Smart Syllabus Management System (SSMS)

Single-school (CBSE) system to plan, record and track syllabus progress by class, section, subject and chapter.

## Stack
pnpm monorepo: `apps/web` (React 18, TS, Vite, Tailwind, RHF/Zod, TanStack Query, Zustand, Recharts), `apps/api` (Node, Express, TS, MongoDB/Mongoose, Zod, JWT, bcrypt), `packages/shared` (roles, permissions, progress calculation; used by both).

## Quick start
1. Requirements: Node 20+, pnpm, a running MongoDB.
2. `pnpm install`
3. Copy `apps/api/.env.example` to `apps/api/.env`; set `MONGODB_URI` and two distinct random secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`).
4. Create the first Super Admin (PowerShell):
   `$env:ADMIN_USERNAME='admin'; $env:ADMIN_EMAIL='admin@school.example'; $env:ADMIN_PASSWORD='<strong password>'; pnpm bootstrap:admin`
   The account must change its password at first login.
5. `pnpm dev:api` (port from `.env`) and `pnpm dev:web` (Vite dev server, proxies `/api`).

## Commands
`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @ssms/api backup`.
API tests use the `ssms_test` database only (guarded) and never touch dev data.

## Docs
See [docs/](docs): ARCHITECTURE, DATABASE_DESIGN, API_DOCUMENTATION, SECURITY_POLICY, IMPLEMENTATION_STATUS, MANUAL_TESTING, DEPLOYMENT_GUIDE, BACKUP_RESTORE_GUIDE, ADMIN_USER_GUIDE, TEACHER_USER_GUIDE, DEVELOPMENT_ROADMAP, CHANGELOG.
