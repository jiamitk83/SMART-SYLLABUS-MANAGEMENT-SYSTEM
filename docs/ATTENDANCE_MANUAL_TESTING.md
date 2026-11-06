# Attendance manual testing

Use `ssms_manual_test` only. Never `ssms_dev`.

## Setup
1. Back up: `pnpm --filter @ssms/api backup`.
2. Run once: `pnpm --filter @ssms/api migrate:attendance-permissions`, then sign out and in.
3. Log in as SUPER_ADMIN. Open **Attendance Settings**: set school name (optional logo), threshold 75, weekly off Sunday, Save.
4. Open **Students**, choose a class/section, add 3–5 students (or **Bulk add** `roll, admission, name` lines).

## Mark attendance
1. **Mark Attendance** → session, class, section, today's date. Counts show Unmarked = total.
2. Click **Mark all Present**, change one student to Absent and one to Leave; counts update. **Save draft** → state DRAFT.
3. Search by name and filter by status; verify the list narrows.
4. **Submit register** is disabled until nobody is Unmarked; submit → SUBMITTED.
5. Change a student, **Save correction** → a dialog demands a reason (≥ 5 chars). Confirm → state UPDATED.
6. Try a future date, a Sunday: the page says marking is not allowed.

## Registers
1. **Daily Register**: complete list, totals, Search, Edit (opens Mark), Print (nav hidden, signature lines shown).
2. **Monthly Register**: pick the month; columns 1–28/29/30/31 (try 2024-02 = 29, 2025-02 = 28); `H` for Sundays/holidays, blank for unrecorded; P/A/L/WD/% columns; scroll sideways; PDF/Excel/CSV buttons; Print.
3. Add 25+ students and download the PDF: landscape, header with school/session/class/section/month, repeated header, legend, "Page x of y", signature lines on the last page.

## Reports, student and class views
- **Student Attendance**: pick a student → totals, percentage, month-wise table, daily chips; Below-75% badge when applicable.
- **Class Attendance**: section summary with low-attendance counts.
- **Attendance Reports**: Preview + PDF/Excel/CSV for each report type. Excel/CSV cells starting with `=` are prefixed with `'`.
- **Percentage check**: 3 Present + 1 Absent + 1 Leave = 60% (or 75% with "Exclude Leave" on).

## Holidays and history
1. **Holidays & Calendar** → Add holiday for a future date; it shows on the calendar and appears as `H` in the monthly register and is not a working day.
2. Adding a holiday on a date that already has attendance is refused.
3. **Attendance History**: every mark/correction shows previous → new status, reason, user, time.
4. Choose a section and date, **Lock**; Mark Attendance is now read-only. **Unlock** needs a reason; state becomes UPDATED.

## Roles
- TEACHER: sees only assigned sections; cannot open Students/Settings; cannot lock; can change a submitted register only today (older → 403 without `attendance:correct`).
- PRINCIPAL: all sections, corrections, lock, holidays, settings. ACADEMIC_COORDINATOR: read-only views and reports.
- API checks: calling `/api/attendance/*` with a teacher token for an unassigned section returns 403.
