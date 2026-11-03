# Deployment guide

1. Provision MongoDB (Atlas or self-hosted with auth + TLS). Use a dedicated database and user.
2. Set environment for the API: `NODE_ENV=production`, `PORT`, `MONGODB_URI`, strong unique `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, `CORS_ORIGIN` = the web origin, `COOKIE_SECURE=true`.
3. `pnpm install --frozen-lockfile`, `pnpm build`.
4. Run the API with `pnpm --filter @ssms/api start` under a process manager (systemd/PM2) behind an HTTPS reverse proxy.
5. Serve `apps/web/dist` as static files from the same origin as `/api` (proxy `/api` to the API) so the refresh cookie stays same-site; SPA fallback to `index.html`.
6. Run `pnpm bootstrap:admin` once with `ADMIN_*` variables, then remove them from the environment.
7. Schedule backups (see BACKUP_RESTORE_GUIDE) and monitor logs.
