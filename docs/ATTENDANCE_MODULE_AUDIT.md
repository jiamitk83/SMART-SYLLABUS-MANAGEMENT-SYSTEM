# Attendance module audit

Audit performed before implementation. Goal: add attendance inside the existing SSMS without duplicating sessions, classes, sections or users.

## What already existed (reused)
| Area | Existing asset | Reuse |
|---|---|---|
| Academic sessions / classes / sections | `AcademicSessionModel`, `ClassModel`, `SectionModel` (`models/academic.models.ts`) | Referenced by id. Nothing duplicated. |
| Auth + RBAC | JWT `authenticate`, `authorize(...perms)`, DB-backed role permissions (`RoleModel`), `hasPermission` | New `attendance:*` permissions plug into the same system. |
| Teacher scope | `TeacherAssignment` (teacher ↔ section ↔ subject, per session) | A teacher may use a section if they have an active assignment there. |
| Audit | `audit()` service and `AuditLog` | Exports, settings and holiday changes are audited. |
| Reports | `report.format.ts` (`sendReport` for json/xlsx/pdf) | Extended with CSV; attendance adds its own landscape register PDF. |
| Frontend | `ui` kit, `useSessions`, `Guard`, `Layout` NAV | All pages follow the same patterns. |

## What did not exist (new)
- **No student master**: there was no student collection. A minimal `Student` model (roll no., admission no., name, optional gender/guardian, `isActive`, `sectionHistory`) was added. Admission number is globally unique; roll number is unique per active section.
- Attendance registers, records, history, holidays, attendance settings.

## Findings that shaped the design
1. No existing transactional guarantees (standalone MongoDB is supported) → correctness relies on **unique indexes** (`student+session+date`, `section+date`) and idempotent `bulkWrite`, not multi-document transactions.
2. Role documents are insert-only at seed time → a one-off additive migration (`migrate:attendance-permissions`) grants the new permissions to existing databases.
3. Dates in the app are calendar dates, not instants → attendance dates are stored as `YYYY-MM-DD` strings to avoid timezone drift.
4. Teacher scope in SSMS is by assignment, not "class teacher" → used as the teacher boundary (documented assumption).

## Security review points
- Every route has `authorize('attendance:*')`; section access is re-checked server-side (`assertSectionAccess`, `sectionIdsForQuery`) so a teacher cannot read or write other sections by changing ids.
- History is append-only; students are deactivated, never deleted; holidays cannot be added over a date that already has attendance.
- CSV/Excel exports neutralise spreadsheet formula injection. Logo upload is limited to PNG/JPEG data URLs ≤ 400k characters.
