# Story 10.4: Platform admin manages user accounts

Status: review

## Story

As the platform admin,
I want to view, activate and deactivate accounts,
so that I control who uses the product during the pilot.

## Acceptance Criteria

1. Given the `(admin)` route group (Daylight theme, platform-admin flag checked server-side), when I list users and activate or deactivate one, then the status change takes effect immediately (FR12, NFR17, AR4).
   - Deactivation signs the user out, and `getAuthUser()` blocks them on the next request.
2. An activated user receives a "You're in" email.
3. A migration creates `audit_log`, and every admin write records actor, target, action and time (NFR34).
4. Admin screens meet WCAG 2.1 AA and work down to 768 px (NFR43, UX-DR37).

## Tasks / Subtasks

- [x] Migration `20261116090000_audit_log_and_admin_user_status.sql`:
  - `audit_log` (actor, action, target type and id, detail, time). Append-only by trigger, for every role. Read by the platform admin only; no write policy.
  - `profiles_select_platform_admin`: the platform admin reads every profile.
  - `public.admin_set_user_status(actor, user, status)`: one transaction that checks the actor, changes the status, deletes the user's Auth sessions on deactivation and writes `audit_log`. EXECUTE is service_role only.
- [x] `requirePlatformAdmin()` (page guard: 404 for anyone else) and `getPlatformAdmin()` (action guard) in `src/lib/auth`. The flag is read from `profiles` on every request.
- [x] `/admin` added to the post-sign-in redirect allowlist.
- [x] `(admin)` route group: layout (Daylight, header, Toaster), `/admin` → `/admin/users`, error boundary.
- [x] `/admin/users`: status filters with counts (Waiting for approval first), search by name or email, 50 per page, one action per row.
  - Activate at once; Deactivate behind a confirmation; no action on the admin's own row.
  - The list is read with the admin's own client, through RLS.
- [x] `setUserStatus` action: strict schema, platform-admin check, the audited function through the service client, then the email.
- [x] Mail the app sends itself: `src/lib/email` (nodemailer 8.0.2 over SMTP) and the "You're in" message with a link to `/sign-in`.
  - Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_URL`.
  - Locally and in CI mail goes to Mailpit (`smtp_port = 56325`); `npm run env:local` and the CI env step write the settings.
- [x] Workspace account menu: "Admin: accounts" for platform admins.
- [x] `docs/release.md` and `.env.example`: the mail settings and where accounts are activated.
- [x] Tests:
  - pgTAP `admin_user_status.test.sql` (24): privileges; actor checks; activate; same status again; deactivate ends sessions; append-only; who reads what. `profiles_rls.test.sql` updated for the admin's read.
  - `actions.test.ts` (7), `users-screen.test.tsx` (8), `mailer.test.ts` (7), guards in `get-auth-user.test.ts` (3), `redirect.test.ts`.
  - e2e `admin-users.spec.ts` (4): activate (user gets in, email in Mailpit, audit row); deactivate (signed out at once, blocked, activated again); 404 for other users; axe and 768 px.

## Dev Notes

- **D1, the app sends the email itself.** Auth can only send its own templates, so "You're in" goes out over SMTP from the server (nodemailer). Production needs the SMTP settings in Vercel as well as in Supabase. The same mailer will carry the invite emails of 10.6 and Epic 12.
- **D2, activation never waits for mail.** Without mail settings, or when the send fails, the account is still activated and the admin is told the email was not sent.
- **D3, the email links to sign-in.** It carries no token and signs no one in.
- **D4, deactivation ends sessions in the database.** The function deletes the user's `auth.sessions` rows, so their next request is anonymous; signing in again shows "Your account is not active". Nothing is deleted, and activating again restores access.
- **D5, an admin cannot deactivate their own account**, in the UI, the action and the function. Deactivating another platform admin is allowed.
- **D6, other users get a 404** on `/admin`, not a redirect: the admin area does not announce itself.
- **D7, no audit-log screen yet.** The rows are written and readable by the platform admin through RLS; a viewer can come with 10.9 (activity dashboards) or 10.10 (support lookup).
- **D8, audit rows keep ids, not emails**, and have no foreign keys, so the record outlives a deleted account.

Found on the way:

- The row buttons are disabled until React has taken over the page; a click before that did nothing (seen under e2e load).
- Links in the admin area use the text colour with an underline: the accent on the Daylight header was 4.3:1 (axe).
- `env.server.ts` now passes `TURNSTILE_SECRET_KEY` to the schema like the other server settings.
- The dev server left running since 12 Nov was restarted.
