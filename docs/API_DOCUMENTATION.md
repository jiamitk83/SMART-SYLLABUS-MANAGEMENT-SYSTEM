# API documentation

Base path `/api`. JSON in/out. Auth: `Authorization: Bearer <accessToken>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me` |
| Users / roles | `/users` (GET, POST), `/users/:id` (PATCH), `/users/:id/active`, `/users/:id/reset-password`; `/teachers`; `GET /roles`, `PATCH /roles/:name` |
| Academic | `/academic-sessions` (+ `POST /:id/set-current`), `/classes`, `/sections`, `/subjects`, `/teacher-assignments` — each CRUD with `PATCH /:id/active` |
| Syllabus | `/chapters`, `/topics`, `/subtopics` (CRUD, `POST /reorder`), `GET /syllabus/tree`, `/syllabus/export`, `/syllabus/versions`, `POST /syllabus/import`, `/syllabus/copy` |
| Plans | `/plans` (GET, POST, PATCH /:id, `POST /:id/reschedule`, `DELETE /:id` = cancel) |
| Teaching | `/teaching-records` (GET, POST, PATCH /:id, `POST /:id/submit`, DELETE draft) |
| Progress | `GET /progress/summary`, `/progress/chapters`; `GET|PUT /activities`; `GET|PUT /settings/activity-weights`; `/chapter-completions` (+ `POST /:id/approve|reject|reopen`) |
| Assessments | `/assessments` (CRUD), `PUT /assessments/:id/results` |
| Dashboard / reports | `GET /dashboard`; `GET /reports/:kind?format=json|xlsx|pdf` where kind is daily-teaching, teacher-wise, class-wise, subject-wise, chapter-completion, monthly (`month=YYYY-MM`), annual, pending, delayed |
| Notifications / audit | `GET /notifications`, `POST /notifications/read-all`, `/:id/read`, `/announce`, `/generate`; `GET /audit-logs` |

Pagination: `page`, `pageSize` (max 200). Error format: `{error:{code,message,details?}}`; typical codes 400/401/403/404/409/429.
The route files in `apps/api/src/modules/*/*.routes.ts` hold the exact Zod schemas and are the source of truth.
