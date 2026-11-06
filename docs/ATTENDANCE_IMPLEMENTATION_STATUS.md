# Attendance implementation status

## Permissions
| Permission | SUPER_ADMIN | PRINCIPAL | ACADEMIC_COORDINATOR | TEACHER |
|---|---|---|---|---|
| `attendance:read` | ✔ | ✔ | ✔ | ✔ (assigned sections only) |
| `attendance:mark` | ✔ | – | – | ✔ (assigned sections) |
| `attendance:correct` | ✔ | ✔ | – | – |
| `attendance:lock` (lock / unlock) | ✔ | ✔ | – | – |
| `attendance:manage` (students, holidays, settings) | ✔ | ✔ | – | – |

Teachers may change a *submitted* register only on the same day; later changes need `attendance:correct`. All checks are enforced by the API.

## API (`/api/attendance/...`)
`scope`, `students` (GET/POST/PATCH, `students/bulk`), `sheet`, `daily`, `PUT mark`, `registers`, `registers/lock`, `registers/unlock`, `monthly`, `student/:id`, `class`, `dashboard`, `holidays` (GET/POST/PATCH/DELETE), `history`, `settings` (GET/PUT), `reports/:type?format=json|xlsx|csv|pdf` where type is `register|student|class|monthly|annual|cumulative|low`.

## Frontend pages
Dashboard, Mark Attendance, Daily Register, Monthly Register, Student Attendance, Class Attendance, Attendance Reports, Holidays & Calendar, Attendance History (with lock/unlock), Attendance Settings, plus a Students master page. Nav items and routes are permission-guarded. Registers print via `window.print()` (landscape, nav hidden).

## Rules
- States: `NOT_STARTED → DRAFT → SUBMITTED → UPDATED → LOCKED`. Submit needs every active student marked. Locked registers reject changes (409). Unlock needs a reason (≥ 5 chars) and moves the register to `UPDATED`.
- Changing an already-submitted record requires a reason; every change appends to `AttendanceHistory` (previous status, new status, reason, user, timestamp). Nothing is overwritten silently.
- Future dates, dates outside the session, holidays and weekly-off days cannot be marked. A student cannot have two records for one date (unique index); a student already recorded in another section that day gets 409.
- **Percentage = Present ÷ (Present + Absent + Leave)** over recorded working days; setting `leaveExcluded` changes the denominator to Present + Absent. Holidays/weekly-offs and unrecorded days are never counted. Zero denominator → `-` (no division by zero). Default low-attendance threshold 75%.
- Monthly register supports 28/29/30/31-day months and leap years; `H` marks holidays/weekly offs, blank = unrecorded.
- Register PDF: landscape A4, school name/logo, session/class/section/month, daily matrix, P/A/L/WD/%, legend, "Page x of y", signature lines; 22 students per page (verified with 5, 22 and 48 students).

## Tests
- `packages/shared/src/attendance.test.ts` (9): leap years, month lengths, percentage rules, monthly matrix.
- `apps/api/src/test/attendance.test.ts` (13) and `attendance-reports.test.ts` (7): CRUD, bulk marking, duplicate prevention, holidays, locking, corrections/history, RBAC, teacher restrictions, exports, PDF pagination. They run only on `ssms_test` (`resetTestDb` refuses any other name).
- `apps/web/src/test/attendance.test.tsx` (4): mark-all, submit rules, correction reason, locked read-only.

## Deployment (existing database)
1. `pnpm --filter @ssms/api backup` (backup first).
2. Confirm the effective database name is `ssms_manual_test` (never `ssms_dev`).
3. `pnpm --filter @ssms/api migrate:attendance-permissions` – additive `$addToSet`, idempotent. Until run, non-super-admin roles get 403 on attendance. New collections are created lazily; no existing collection is changed.

## Assumptions / limitations
- Teacher scope = any active teaching assignment in that section.
- Standalone MongoDB: no multi-document transactions; integrity via unique indexes.
- Students must be added (Students page / bulk add) – there was no existing student master to import.
- Weekly off defaults to Sunday; configurable in settings.
