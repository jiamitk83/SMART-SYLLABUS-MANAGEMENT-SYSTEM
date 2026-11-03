# Database design (MongoDB / Mongoose)

Collections: `users`, `roles` (permission sets), `academicsessions` (one current), `schoolclasses`, `sections`, `subjects`, `teacherassignments` (section x subject x teacher per session), `chapters`, `topics`, `subtopics`, `syllabusversions` (change history), `plans` (ANNUAL/MONTHLY/WEEKLY, with reschedule history), `teachingrecords` (DRAFT/SUBMITTED; unique per section+subject+date+period), `activityrecords` (per section+chapter+activity type, with history), `chaptercompletions` (PENDING_APPROVAL/APPROVED/REJECTED/REOPENED, with history), `assessments` (WORKSHEET/TEST with embedded results), `notifications` (deduplicated by `dedupeKey`), `auditlogs` (append-only; update/delete hooks are blocked), `refreshtokens`, `settings` (activity weights).

Principles: references by ObjectId, indexes on session/class/section/subject filters, soft deactivation (`isActive`) instead of deletion for master and syllabus data, plan cancellation is a soft state, and audit logs are immutable.
Hierarchy invariants (class belongs to session, chapter to class+subject, etc.) are verified server-side before writes.
