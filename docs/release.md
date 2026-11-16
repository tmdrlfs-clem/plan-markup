# Releasing Plan Markup (Story 8.5)

Production runs on **Vercel (`syd1`)** with **Supabase cloud (ap-southeast-2, Sydney)**.
`.github/workflows/release.yml` releases every green `main`:

1. **migrate**: `supabase db push` applies new migrations to the cloud project.
2. **deploy**: `vercel build` and `vercel deploy --prebuilt --prod` (Vercel's own Git deploys of `main` are off in `vercel.json`, so the app never goes out before its migrations).
3. **verify**: `GET $PRODUCTION_URL/api/health` must answer 200.

Each job skips itself with a notice until its secrets exist. Run it by hand from Actions → Release → Run workflow.

## One-time setup

1. **Supabase project**: create "plan-markup" in region **ap-southeast-2 (Sydney)**, Postgres 17. Keep the database password.
2. **Supabase Auth settings** (Authentication → Providers / URL configuration):
   - keep email sign-ups on, with **Confirm email** on (Story 10.1). New accounts start `pending` until the platform admin activates them;
   - set Site URL to the production URL;
   - Emails → Templates → **Confirm signup**: subject and body from `supabase/templates/confirmation.html` (its link goes to `/auth/confirm`);
   - Emails → Templates → **Reset password**: from `supabase/templates/recovery.html` (Story 10.2);
   - Emails → Templates → **Change email address**: from `supabase/templates/email_change.html` (Story 10.3); keep **Secure email change** on (both addresses confirm);
   - Authentication → Email provider: **Secure password change** on (a session older than 24 h must re-authenticate to change the password);
   - Emails → **SMTP settings**: a transactional provider (for example Resend or Postmark) with a verified sending domain. Supabase's built-in mailer is for testing only;
   - Authentication → Rate limits: emails per hour to suit the SMTP plan.
   - Storage buckets and policies come from the migrations.
3. **Vercel project**: import the GitHub repo, framework Next.js, region `syd1` (from `vercel.json`). Environment variables (Production):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (Cloudflare → Turnstile, a widget for the production hostname). Required: without the secret, sign-up refuses everyone in production.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_URL` (Story 10.4): the SMTP account from step 2 again, a sender on the verified domain (for example `Plan Markup <no-reply@your-domain>`) and the production URL. The app sends the "You're in" email itself when you activate an account, and company invitations (Story 10.6). Without them accounts are still activated (the admin screen says the email was not sent), but no invitation can be made.
   - `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`
   - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (source maps; optional)
4. **GitHub**:
   - In Settings → Environments, create **production** (required reviewer: you; deployment branches: `main` only).
   - Add these secrets to it:
     - `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access tokens)
     - `SUPABASE_DB_PASSWORD`
     - `SUPABASE_PROJECT_REF`
     - `VERCEL_TOKEN` (vercel.com → Account → Tokens)
     - `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (`.vercel/project.json` after `npx vercel link`)
   - Add the repository variable `PRODUCTION_URL` (for example `https://plan-markup.vercel.app`).
5. **Sentry**: create a Next.js project. Its DSN goes in step 3. Check that errors arrive by opening `/workspace` and running `throw new Error("sentry check")` from the browser console, then confirm the event in Sentry.
6. **Uptime monitoring (NFR38)**: in an uptime service (for example UptimeRobot or Better Stack), add an HTTP monitor on `$PRODUCTION_URL/api/health`. Use a 1–5 minute interval, alert on non-200 (it answers 503 when Supabase is down), and send alerts to your e-mail.
7. **First admin**: `npm run admin:create-user` against production (with the production URL and service-role key in a temporary env, never committed). After that, new sign-ups are activated at `/admin/users` (Story 10.4; also in the workspace's account menu → Admin: accounts).

## Every release

- Merge to `main` → CI → Release runs. Approve the `production` environment when asked.
- Migrations are forward-only. Write them so the previous app version still works while the new one deploys (add columns or tables; drop in a later release).
- After the release: open the production URL, sign in, open a drawing, measure, export.
