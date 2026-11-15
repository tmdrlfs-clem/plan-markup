# Story 10.3: View and edit my profile

Status: done

## Story

As a user,
I want to see and edit my name and email,
so that my markups show the right author.

## Acceptance Criteria

1. Given Settings → Account, when I change my name or email, then the name updates immediately (FR4).
   - An email change requires verification of the new address.
2. Protected fields (status, role, company, plan, admin flag) cannot be changed through any endpoint (NFR24).

## Tasks / Subtasks

- [x] `ProfileSection` at the top of Settings → Account & signature:
  - a Name field with "Save name", which refreshes the workspace so new markups and revision stamps carry the name;
  - the email with "Change email…", which sends the links.
- [x] `updateName` action:
  - strict schema (name only, 1–100 characters);
  - writes through RLS and the column grant (name and theme only).
- [x] `changeEmail` action:
  - strict schema; refuses the current email;
  - rate limit `email_change_user` 5/h, failing closed;
  - `auth.updateUser({ email })`;
  - an address already in use gets the same answer.
- [x] Auth sends `supabase/templates/email_change.html` to both addresses (`double_confirm_changes`).
  - `/auth/confirm` handles `email_change`. The first link lands on `/email-change?step=other`, the second on `?step=done`.
  - `/email-change` is public, since a link may be opened in another browser.
- [x] Migration `20261114090000_profiles_email_sync.sql`: a trigger copies `auth.users.email` to `profiles.email` once Auth applies the change.
- [x] `docs/release.md`: the email-change template, and keep Secure email change on.
- [x] Tests:
  - pgTAP `profiles_email_sync.test.sql` (8): sync; untouched by other updates; the function is not callable; name writable; email, status and admin flag not writable;
  - `profile-actions.test.ts` (8);
  - `profile-section.test.tsx` (3);
  - e2e `profile.spec.ts`: name saved and shown; email links to both addresses; unchanged after the first link; changed after the second; sign in with the new email.
- [x] The e2e helpers for SQL, test accounts and Mailpit links are in `e2e/auth-mail.ts`, now used by the 10.1–10.3 specs.

## Dev Notes

- **D1, both addresses confirm.** The AC asks for the new address to be verified. Auth's "Secure email change" also asks the old address. It stays on, so a session left open cannot move the account to another email.
- **D2, where it lives.** Name and email are in the existing "Account & signature" dialog. There is no separate settings page yet.
- **D3, role, company and plan.** These columns do not exist yet (10.5–10.8). When they arrive they must follow the same pattern: no column grant, and admin writes only. The pgTAP test covers the fields that exist today.
- **D4, name required.** The name cannot be blank. An empty name made the author fall back to the email.
