# Implementation status

| Module | Status |
|---|---|
| Auth (login, refresh rotation, change/forgot/reset password, forced change) | Done, API-tested |
| Users & role/permission management | Done |
| Academic masters (sessions, classes, sections, subjects, teacher assignments) | Done |
| Syllabus hierarchy, reorder, import/export JSON, versions, copy between sessions | Done |
| Plans (annual/monthly/weekly, reschedule with reason, cancel, calendar/table) | Done |
| Daily teaching (draft/submit, duplicate protection, no future dates; SUPER_ADMIN may enter on behalf of a teacher with `createdBy`/`enteredOnBehalf` audit trail, TEACHER restricted to own assignments) | Done |
| Activities & weights (6 weighted activities, N/A handling) | Done |
| Activity corrections (`activities:manage`, mandatory reason, append-only history, audit `ACTIVITY_CORRECTED`) | Done, API-tested |
| Chapter completion with approval workflow | Done |
| Progress calculations | Done, 22 unit tests in shared |
| Dashboards (role-aware) | Done |
| Reports (9 kinds, JSON preview, Excel, PDF) | Done |
| Assessments (worksheets/tests, results, feed activities) | Done |
| Notifications, announcements, reminders | Done (in-app only) |
| Audit log | Done |

## Verification
`pnpm typecheck` clean for all packages. Tests: shared 26, api 40 (against `ssms_test`), web 5. `pnpm build` succeeds (web bundle ~880 kB; not code-split; the API build uses `apps/api/tsup.config.ts`).

## Optional topic / subtopic teaching

Topic and subtopic are optional end to end (form, API schemas, model); a subtopic still requires a topic. Only SUBMITTED records count (drafts are ignored). Teaching % per section × chapter:
- Topic-level records: weighted by topic `estimatedPeriods` (best status per topic: COMPLETED 100, PARTIAL 50, NOT_TAUGHT 0), unchanged.
- Chapter-level records (no topic): best status per chapter on the same scale.
- Both present: the chapter's teaching % is the **higher** of the two (never the sum), so the same work is not double-counted. For a chapter with no topics, a stored TEACHING activity value is also compared the same way.
- No schema change, no migration; historical records are untouched (earlier topic-less submissions now count). TeachingPage now refreshes the Progress data after save/submit/delete.

## Progress correction model
- Total progress is always calculated automatically; there is no endpoint to set a chapter/overall percentage.
- `PUT /api/activities` (permission `activities:manage`) sets one activity's **status**: `PENDING` (0%), `COMPLETED` (100%) or `NOT_APPLICABLE` (excluded; remaining weights re-normalised). Percentages are no longer accepted by the API or shown in the UI. Weights are unchanged (Teaching 40, Notebook work 15, Notebook correction 15, Worksheet 10, Test 10, Revision 10) and Teaching is still calculated automatically. SUPER_ADMIN, PRINCIPAL and ACADEMIC_COORDINATOR can correct any class; a TEACHER only assigned section+subject (`assertTeacherAssigned`). `teaching:write` no longer grants this.
- **Existing data (no migration):** storage stays `{applicable, percent}`; status is derived (`activityStatusOf` in `packages/shared/src/progress.ts`): not applicable -> N/A, 100 -> Completed, 0 -> Pending. A legacy percentage strictly between 0 and 100 is never converted: it keeps counting at its stored value (so no chapter's progress changes), is displayed as "Partial NN%" and only changes when a user explicitly picks a new status, which is logged with the partial value as the previous value. Old history entries (percent only) display consistently.
- A reason (min 5 chars) is mandatory. No-op corrections are rejected. TEACHING cannot be corrected for chapters that have topics (it is derived from submitted daily records).
- Each correction appends to the record's `history` (previous and new value, activity type, class/section/subject/chapter, user, time, reason) and writes an `ACTIVITY_CORRECTED` audit entry. History is never deleted. `GET /api/activities/history?section=&chapter=` returns it (teachers: assigned only).
- Worksheet/Test auto-sync (`syncActivities`) only inserts a record when none exists (`$setOnInsert`); it never overwrites an existing record or a correction. Behaviour change: an existing manual Worksheet/Test value is no longer raised to 100 by a later assessment.
- Submitted teaching records still cannot be deleted (drafts only).
- **Deployment step for existing databases:** role documents are insert-only, so run `pnpm --filter @ssms/api backup` then `pnpm --filter @ssms/api migrate:activities-permission` once (additive `$addToSet` for PRINCIPAL, ACADEMIC_COORDINATOR, TEACHER). Until then those roles get 403 on corrections. No schema migration is needed: new history fields are optional and legacy entries remain valid.

## Not done / limitations
- No e-mail/SMS delivery; reset token is logged outside production.
- Coordinator/Principal are not scoped to specific classes.
- Frontend test coverage is limited (schema, ProgressBar, DataTable, login validation); end-to-end browser flows are covered only by `MANUAL_TESTING.md`.
- Reminders are generated on demand (`Generate reminders`), not by a scheduler.
- UI components are hand-written shadcn-style, not the shadcn CLI.
- Bundle is a single chunk; route-level code splitting is a possible improvement.

## Attendance module
Implemented (students, mark/daily/monthly registers, reports and PDF/Excel/CSV, holidays, history, lock/unlock, settings, RBAC). Details: [ATTENDANCE_IMPLEMENTATION_STATUS.md](ATTENDANCE_IMPLEMENTATION_STATUS.md), [ATTENDANCE_MODULE_AUDIT.md](ATTENDANCE_MODULE_AUDIT.md). Existing databases need `migrate:attendance-permissions` after a backup.
