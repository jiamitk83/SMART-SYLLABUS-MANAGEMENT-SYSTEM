# Backup and restore

- Backup: `pnpm --filter @ssms/api backup` writes a dump of the configured database to a timestamped location (see script output). Run it before any upgrade or structural change, and on a schedule in production.
- Backups are not committed to git and contain personal data; keep them encrypted and access-controlled.
- Restore: stop the API, restore into an **empty/new** database first, verify, then point `MONGODB_URI` at it. Never restore over a live database without a fresh backup.
- Test databases: automated tests only use `ssms_test` and refuse to run destructive cleanup on any other name. Never run tests with `MONGODB_URI` pointing at `ssms_dev` or production.
