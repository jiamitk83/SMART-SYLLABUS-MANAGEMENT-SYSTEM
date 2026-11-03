# Implementation status

| Module | Status |
|---|---|
| Auth (login, refresh rotation, change/forgot/reset password, forced change) | Done, API-tested |
| Users & role/permission management | Done |
| Academic masters (sessions, classes, sections, subjects, teacher assignments) | Done |
| Syllabus hierarchy, reorder, import/export JSON, versions, copy between sessions | Done |
| Plans (annual/monthly/weekly, reschedule with reason, cancel, calendar/table) | Done |
| Daily teaching (draft/submit, duplicate protection, no future dates) | Done |
| Activities & weights (6 weighted activities, N/A handling) | Done |
| Chapter completion with approval workflow | Done |
| Progress calculations | Done, 22 unit tests in shared |
| Dashboards (role-aware) | Done |
| Reports (9 kinds, JSON preview, Excel, PDF) | Done |
| Assessments (worksheets/tests, results, feed activities) | Done |
| Notifications, announcements, reminders | Done (in-app only) |
| Audit log | Done |

## Verification
`pnpm typecheck` clean for all packages. Tests: shared 22, api 18 (against `ssms_test`), web 5. `pnpm build` succeeds (web bundle ~880 kB; not code-split).

## Not done / limitations
- No e-mail/SMS delivery; reset token is logged outside production.
- Coordinator/Principal are not scoped to specific classes.
- Frontend test coverage is limited (schema, ProgressBar, DataTable, login validation); end-to-end browser flows are covered only by `MANUAL_TESTING.md`.
- Reminders are generated on demand (`Generate reminders`), not by a scheduler.
- UI components are hand-written shadcn-style, not the shadcn CLI.
- Bundle is a single chunk; route-level code splitting is a possible improvement.
