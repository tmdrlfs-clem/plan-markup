# Story 10.2: Reset my password

Status: review

## Story

As a user,
I want to reset a forgotten password by email,
so that I can get back in.

## Acceptance Criteria

1. Given "Forgot password", when I request a reset (Turnstile, rate-limited), then a single-use link lets me set a new password (FR2, NFR16, NFR18).
   - The link is bound to my email and valid for at most 1 hour.
   - The response is the same whether or not the email exists.
2. Changing the password revokes all my other sessions (NFR17).
3. Redirects after reset use the allowlist (NFR19).

## Tasks / Subtasks

- [x] `/forgot-password`:
  - email field plus Turnstile;
  - answers "Check your email" for any valid address;
  - a "Forgot password?" link on sign-in.
- [x] `requestReset` action:
  - parse;
  - rate limit (`reset_ip` 10/h, `reset_email` 3/h; fails closed);
  - Turnstile;
  - `resetPasswordForEmail`.
- [x] Reset email:
  - `supabase/templates/recovery.html` links to `/auth/confirm?token_hash=…&type=recovery`;
  - the confirm route signs in with it and goes to `/reset-password`;
  - the link expires after 1 h (`otp_expiry`) and works once.
- [x] `/reset-password`:
  - only a session opened from an emailed link within the last hour may set a password without the current one (`sessionCameFromRecovery`, verified claims);
  - otherwise it shows "Open the link from your email" with a link for a new one.
- [x] `resetPassword` action:
  - checks length, leaked password and same password;
  - `updateUser`, then `signOut({ scope: "others" })`;
  - redirects via `sanitizeNextPath` (active) or to PendingActivation (pending).
- [x] Shared `useTurnstileGate` hook: sign-up and forgot-password both wait for the check before submitting.
- [x] Guards updated:
  - `supabase-auth-config.test.ts` now requires confirmations on, and checks both templates link to `/auth/confirm`;
  - a comment rewritten that the near-sharp guard read as a blur class.
  - These two failed CI on 1d02682.
- [x] Tests:
  - `password-reset-actions.test.ts` (7);
  - reset helpers in `sign-up-checks.test.ts`;
  - form tests;
  - e2e `password-reset.spec.ts`: an unknown email gets the same answer; `/reset-password` without the link is refused; the link leads to the new password; the link is single-use; another signed-in browser is signed out; the old password fails and the new one works.

## Dev Notes

- **D1, which sessions may reset.** Auth records a token-hash reset link as amr method `otp`, not `recovery` (checked locally). Both are accepted when under one hour old.
  - The app has no other OTP or magic-link sign-in, so `otp` only comes from our emailed links.
  - A user who confirmed sign-up within the hour could also set a password here. Both cases prove control of the email just now.
- **D2, pending users.** Pending and deactivated accounts can reset too. Afterwards they land on PendingActivation, so the reset gives no workspace access.
- **D3, limits.** Per email: 3 requests an hour. Per IP: 10 an hour. Auth's own email limit applies as well.
- **D4, after the reset.** The device that reset stays signed in and goes to the workspace. All other sessions end at once: Auth rejects their tokens on the next request, as the e2e shows.
