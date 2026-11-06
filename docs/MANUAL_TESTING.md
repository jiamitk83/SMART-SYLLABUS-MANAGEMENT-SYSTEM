# Manual testing

Prereq: API and web running, Super Admin bootstrapped.

1. **Login/first change:** log in as admin; you are redirected to Profile to change the password; afterwards you reach the dashboard. Wrong password 5+ times -> rate limit message.
2. **Masters (Academic):** create session (set current), classes, sections, subjects; create teacher users in Users; assign teachers to section+subject.
3. **Syllabus:** pick class+subject; add chapters, topics, subtopics; reorder; export JSON; re-import it on another subject; check Version history.
4. **Plans:** create a monthly plan for a chapter; reschedule (reason required); cancel; toggle calendar view.
5. **Teaching (as teacher):** record a period; save draft then submit; try the same section/subject/date/period again -> conflict; try an unassigned section -> not selectable; future date blocked.
6. **Progress:** open Progress; the table shows Completed / Pending / N/A badges (and the overall % per chapter). Click Correct, set Notebook work to Completed and Revision to N/A, enter a reason (Save stays disabled without one and until something changes) and confirm the total re-normalises. Open History and check previous -> new status, user, time and reason. Any old partial value appears as "Partial NN% (existing)" and stays unless you pick a status. Repeat as coordinator/principal (any class) and as a teacher (assigned classes only; unassigned classes return 403 via the API).
6a. **Roles:** in Roles, `activities:manage` is listed per role; untick it for Teacher, save, and confirm the Correct button disappears and the API returns 403 after re-login/refresh (up to 30 s cache).
6b. **Sync safety:** record a worksheet as conducted (Worksheet becomes Completed), correct it to Pending with a reason, record another worksheet for the same chapter and confirm it stays Pending.
7. **Completion:** teacher requests completion; coordinator approves in Completions; chapter shows Completed only now. Reject/reopen path.
8. **Assessments:** create a test, enter results, check summary and that Test activity updates.
9. **Reports:** generate each report; download Excel and PDF.
10. **Notifications:** announce to Teachers; teacher sees badge, marks read. Generate reminders as coordinator.
11. **Settings:** change weights; total != 100 disables Save.
12. **Roles/permissions:** as teacher, `/users` and `/audit` are inaccessible (redirect) and the API returns 403.
13. **Audit:** admin filters by action and date.
14b. **Optional topic/subtopic:** submit a record with only class-section, subject, chapter, status and description (no validation error for empty Topic/Subtopic; Subtopic is disabled until a Topic is chosen). Open Progress (it refreshes automatically): Teaching shows Completed = 100%, Partial = 50%, Not taught = 0% for that chapter; drafts add nothing. For a chapter with topics, mixing topic and chapter-level records shows the higher value, not the sum.
14. **Daily teaching as SUPER_ADMIN:** open Daily teaching, pick any class-section and subject; the "Teaching teacher" selector lists the assigned teachers (Auto uses the single assigned teacher). Save a record: it shows under the teacher, while the audit log (`TEACHING_RECORD_CREATED`) and the record history show you as the creator with `onBehalf`. As a TEACHER, only assigned sections/subjects appear and an unassigned one is rejected by the API (403).

## Attendance
See [ATTENDANCE_MANUAL_TESTING.md](ATTENDANCE_MANUAL_TESTING.md).
