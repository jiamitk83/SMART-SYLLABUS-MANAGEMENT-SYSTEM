# Manual testing

Prereq: API and web running, Super Admin bootstrapped.

1. **Login/first change:** log in as admin; you are redirected to Profile to change the password; afterwards you reach the dashboard. Wrong password 5+ times -> rate limit message.
2. **Masters (Academic):** create session (set current), classes, sections, subjects; create teacher users in Users; assign teachers to section+subject.
3. **Syllabus:** pick class+subject; add chapters, topics, subtopics; reorder; export JSON; re-import it on another subject; check Version history.
4. **Plans:** create a monthly plan for a chapter; reschedule (reason required); cancel; toggle calendar view.
5. **Teaching (as teacher):** record a period; save draft then submit; try the same section/subject/date/period again -> conflict; try an unassigned section -> not selectable; future date blocked.
6. **Progress:** open Progress; set Notebook work 100% via Activities; mark Revision N/A and confirm total re-normalises; progress bars update.
7. **Completion:** teacher requests completion; coordinator approves in Completions; chapter shows Completed only now. Reject/reopen path.
8. **Assessments:** create a test, enter results, check summary and that Test activity updates.
9. **Reports:** generate each report; download Excel and PDF.
10. **Notifications:** announce to Teachers; teacher sees badge, marks read. Generate reminders as coordinator.
11. **Settings:** change weights; total != 100 disables Save.
12. **Roles/permissions:** as teacher, `/users` and `/audit` are inaccessible (redirect) and the API returns 403.
13. **Audit:** admin filters by action and date.
