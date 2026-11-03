# Security policy

- Passwords: bcrypt (`BCRYPT_ROUNDS`), policy min 10 chars with upper, lower and digit; enforced on API and UI. Bootstrap/reset passwords force a change at next login.
- Tokens: short-lived access JWT, rotating httpOnly refresh cookie (`COOKIE_SECURE` true in production) with reuse detection; refresh/logout require the `X-Requested-With: ssms` header (CSRF guard).
- Login rate limiting (`LOGIN_RATE_MAX` per `LOGIN_RATE_WINDOW_MIN`), generic error messages (no user enumeration), reset tokens stored hashed with a TTL.
- Authorization is enforced server-side per permission; teachers limited to assigned section/subject.
- Input validated with Zod; Mongo operator injection is blocked by schema validation; `helmet` and a restrictive CORS origin are enabled.
- Audit log is append-only and records logins, user/role changes, syllabus/plan changes, approvals and weight changes.
- Secrets live only in `.env` (never committed). Backups contain personal data: store them securely.

## Known limitations
- No mail transport: forgot-password only logs the reset token outside production. Admins can reset passwords from Users.
- Coordinators and the Principal see all classes (no per-class scoping).
- Access token is kept in memory; page reload re-authenticates via the refresh cookie.
