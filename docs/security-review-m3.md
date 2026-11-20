# M3 security review (Story 10.14, NFR36)

Date: 2026-11-17 · Scope: what Epic 10 added since the M2 review (`docs/security-review-m2.md`): sign-up, password reset, email change, the platform admin area (accounts, companies, plans, activity, support lookup, rule figures), companies, invitations, member changes, company tool sets and the company use → hazard mapping. Also a fresh pass over every table's grants, which found M2 below.
Result: **no open High findings.**

## What was checked

| Area | Check | Result |
|---|---|---|
| RLS matrix | `supabase/tests/rls_matrix.test.sql`: 8 roles (anonymous, pending, active in no company, owner/company admin, member, viewer, another company's admin, platform admin) × 22 tables and row kinds: rows read, updated, deleted, and a forged insert of the owner's row. Fails when a table or view is added without a line | Pass (184 assertions; the whole pgTAP suite is 717) |
| Table grants | No `TRUNCATE`, `TRIGGER` or `REFERENCES` for `anon` / `authenticated`; `anon` holds nothing on any table; a new table grants nothing to them until its migration says so (default privileges) | Pass after the fix (see M2) |
| Views | `zones` is `security_invoker`, select only; the matrix checks every view is | Pass |
| SECURITY DEFINER | 36 functions in `public` / `app`, every one with `search_path = ''`; none executable by `anon`; the admin and company functions (`admin_*`, `set_company_*`, `create_company_invitation`, …) are `service_role` only and check their actor again in the same transaction | Pass |
| Audit log | Append-only (trigger refuses update and delete), written only inside the admin and company functions in the same transaction as the change, read by the platform admin only | Pass (see L8) |
| Server actions | Every exported action checks the caller first (`getAuthUser`, `getPlatformAdmin`, `getCompanyAdmin`), except the ones before sign-in by design: `signIn`, `signUp`, `requestReset`, `confirmLink`, `resetPassword` (only a session opened from the reset link), `joinCompany` (signed-in or pending session), `joinWithNewAccount` (rate limit, password rules and the invitation's own email) | Pass |
| Sign-up and sign-in | Turnstile, HIBP check, per-IP and per-email rate limits, email confirmation; new accounts are `pending` and see nothing through RLS until activated | Pass (see M3) |
| Password reset, email change | Reset sets a password only from a recovery session and signs out other sessions; an email change is confirmed at both addresses; `secure_password_change` on | Pass |
| Invitations | Random token, only its SHA-256 stored; valid 7 days at most; bound to the invited email; one use; sending rate-limited per admin | Pass |
| Platform admin | Every admin page and action checks the flag itself (layouts do not re-run on client navigation); the admin cannot read or write a company's own mapping; support lookup is audited | Pass |
| Rule figures | Written only through the audited functions; a draft is used by nobody; the version in use is the newest verified one; the M2 finding L5 is closed | Pass |
| Emails | Every value in the HTML is escaped; links are built from `APP_URL`; no user text in headers except the company name (see L6) | Pass |
| XSS sinks | No `dangerouslySetInnerHTML`, `innerHTML =`, `eval` or `new Function` in `src` | Pass |
| Dependencies | `npm audit --omit=dev`: 0 high, 0 critical, 6 moderate (see L2, L7) | Pass |

## Findings

- **M2 (Medium, fixed in this story)**: five tables (`rule_figures`, `use_hazard_map`, `signatures`, `tool_sets`, `tools`) still granted `TRUNCATE`, `TRIGGER` and `REFERENCES` to `authenticated`, left over from Supabase's default privileges. `TRUNCATE` ignores row level security, so a signed-in role with a direct database connection could empty a table of everyone's rows. The API (PostgREST) has no TRUNCATE and nobody gets a direct connection as `authenticated`, which is why it is Medium, not High. Fixed: `20261127090000_revoke_table_extras.sql` revokes the three on every table and changes the default privileges so a new table grants nothing to `anon` or `authenticated`; the matrix test fails if either comes back.
- **M3 (Medium; sign-up closed 2026-11-20, sign-in open until public launch)**: calling Supabase Auth directly with the public anon key skipped our Turnstile check, our rate limits and the HIBP check (sign-up, sign-in, magic link). Left open by the founder on 2026-11-12; taken up on 2026-11-20.
  - **Sign-up: closed.** Public sign-up is off in Supabase Auth (`enable_signup = false`; production: Allow new users to sign up off, `docs/release.md` step 2). Accounts are made only by `src/lib/auth/sign-up.ts` with the service role (`generateLink` "signup", after the app's rate limit, Turnstile and HIBP checks), and the app mails the confirmation link itself. e2e `sign-up.spec.ts` checks that a direct `/auth/v1/signup` is refused (`signup_disabled`). With sign-ups off, a direct magic-link or OTP request cannot make an account either.
  - **Sign-in: still open, before public launch.** A direct password sign-in is limited only by Supabase's own per-IP limits. Closing it needs Supabase Auth captcha with the Turnstile token forwarded from the app (and `change-password.ts` moved off `signInWithPassword`, which would then need a token too); it waits for the Turnstile keys. Meanwhile keep Supabase's Auth rate limits tight (`docs/release.md` step 2).
  - **Breached passwords**: a signed-in user can still set a password through Auth directly, past our HIBP check. **Leaked password protection** (Supabase Pro) covers it.
- **M1 (Medium, config, from M1)**: protect the GitHub `production` environment (required reviewer, `main` only). Still to be done with the cloud setup (`docs/release.md` step 4).
- **L2 (Low, from M1)**: moderate advisories in `glob` / `minimatch` (build-time file matching), now reached through `@sentry/nextjs` too. Not reachable with attacker input. Track.
- **L3 (Low, ops, updated)**: the production Auth settings must match the app: Confirm email on, Secure email change on, Secure password change on, the site URL, the email templates and SMTP (`docs/release.md` step 2). Sign-ups stay on since Story 10.1 (accounts start `pending`).
- **L4 (Low, from M2)**: a saved zone layout's `report` is the client's; nothing reads it back yet. Unchanged.
- **L6 (Low, accepted)**: the company name goes into the invitation email's subject. Names are set by the platform admin only, and nodemailer encodes header values, so a line break cannot start a new header.
- **L7 (Low)**: Next.js 16.4.2 has a moderate advisory (information disclosure across root params through `'use cache'` and `unstable_cache`). The app uses neither. The upgrade `next dev` recommends waits on the founder's decision; take it with the next dependency update.
- **L9 (Low, accepted by the founder 2026-11-19, review 2026-12-18)**: `picomatch` ReDoS (GHSA-fc5q-39xc-vjpf, High, every version up to 4.0.7, no fix published). Reached only through `@sentry/nextjs`'s build-time bundler plugins, which match our own file paths, never user input. CI's runtime audit (`scripts/audit-runtime.mjs`) accepts this one advisory until the review date; any other high or critical still fails.
- **L8 (Low, ops)**: no screen shows `audit_log`; reading it needs SQL. Fine for one platform admin; add a view before there are more.

Closed since M2: **L5** (rule figures change control), by Story 10.13.

## Not covered here

- Penetration testing by a third party (post-pilot).
- The production project itself (Pro plan, point-in-time recovery, SMTP, Auth settings): checked against `docs/release.md` → "M3 gate" when it exists.
