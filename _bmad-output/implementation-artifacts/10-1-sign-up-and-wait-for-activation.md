# Story 10.1: Sign up and wait for activation

Status: review

## Story

As a visitor,
I want to create an account,
so that I can request access to Plan Markup.

## Acceptance Criteria

1. Given `/sign-up`, when I submit email and password with Cloudflare Turnstile, then I must verify my email before anything else, and my profile is `pending` (FR1, NFR14, NFR18, AR18).
   - The password is at least 12 characters, has show/hide, and passes a leaked-password check.
   - There is no maximum below 64 characters.
2. A transactional email provider is configured for Supabase Auth SMTP. Local dev uses the Supabase mail catcher.
3. Responses never reveal whether the email already exists. Sign-up is rate-limited (NFR15, NFR16).
4. Signing in while pending shows PendingActivation "Your account is waiting for approval", with what happens next and no workspace access (UX-DR30, F6).

## Tasks / Subtasks

- [x] `/sign-up` page and `SignUpForm`:
  - email field, plus a password field (TextField's show/hide), with a 12-character hint;
  - Turnstile when a site key is set; "Check your email" after submitting;
  - links between sign-in and sign-up.
- [x] `signUp` server action (`features/account/sign-up-actions.ts`) runs these steps in order:
  - parse;
  - rate limit (`sign_up_ip` 10/h, `sign_up_email` 5/h; fails closed);
  - Turnstile;
  - leaked-password check;
  - `supabase.auth.signUp`.
  - The answer is the same for new and existing emails.
- [x] `lib/auth/turnstile.ts`:
  - checked whenever `TURNSTILE_SECRET_KEY` is set;
  - required when `VERCEL_ENV=production`, failing closed without the secret;
  - skipped locally, in CI and in e2e.
- [x] `lib/auth/pwned.ts`:
  - Have I Been Pwned range API: only 5 hex characters of the SHA-1 leave the server, with padding;
  - fails open (logged) when the service is down.
- [x] `lib/auth/sign-up.ts`: maps Auth errors. `user_already_exists` counts as success.
- [x] Email confirmation:
  - `enable_confirmations = true`;
  - `supabase/templates/confirmation.html` links to `/auth/confirm?token_hash=…&type=email`;
  - the `/auth/confirm` route verifies, then redirects to `/pending-activation`;
  - a bad or used link goes to `/sign-in?link=invalid` with a notice.
- [x] Sign-in: an unconfirmed email says "Confirm your email first". That message only appears after the right password.
- [x] Proxy: `/sign-up` and `/auth/confirm` are public. CSP: `frame-src` allows `https://challenges.cloudflare.com`.
- [x] CI starts Mailpit (sign-up sends mail). `docs/release.md` covers the hosted Auth settings, template, SMTP provider and Turnstile keys. `.env.example` documents the keys.
- [x] Tests:
  - `sign-up-actions.test.ts` (7), `sign-up-checks.test.ts` (12), `sign-up-form.test.tsx` (5), plus the CSP test;
  - e2e `sign-up.spec.ts`: sign up, the confirmation email in Mailpit, refused sign-in before confirming, link to pending, link single-use, same answer for the same email.
  - The e2e also ran once locally with Cloudflare's test keys, through the real widget.

## Dev Notes

- **D1, no name field.** Sign-up asks only for email and password, as in the AC. The name is set in Settings → Account (10.3).
- **D2, password limit.** The limit is 72 bytes, which is Auth's bcrypt limit. That is 72 Latin characters, fewer with accented letters.
- **D3, leaked check fails open.** If HIBP is down, sign-up goes ahead and a warning is logged. Turnstile fails closed.
- **D4, submit waits for Turnstile.** Submitting before the check finishes shows "Wait for the check below to finish". Each submit gets a fresh widget, because tokens are single-use.
- **D5, blur validation.** Leaving an empty email or password field no longer shows an error; submit still does. The error appearing on blur moved the links below it mid-click (found by e2e), on sign-in too.
- **Production (founder):**
  - Cloudflare Turnstile widget plus the two keys in Vercel;
  - an SMTP provider and domain;
  - the template in the Supabase dashboard (see `docs/release.md`).
