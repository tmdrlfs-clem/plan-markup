# Story 10.6: Company admin invites users

Status: review

## Story

As a company admin,
I want to invite people by email,
so that my team can join our company.

## Acceptance Criteria

1. Given the Company → Members screen, when I invite an email with a role, then the invitee gets a single-use link bound to that email, valid ≤7 days (FR6, NFR18, F6).
   - Signing up or in through it makes them active members immediately.
2. Inviting someone already in another company shows a clear error.
3. Invites are rate-limited and audit-logged.

## Tasks / Subtasks

- [x] Migration `20261118090000_company_invitations.sql`:
  - `company_invitations`: company, email (lower-cased), role, the SHA-256 of the token, inviter, expiry (a check allows 7 days at most), accepted and revoked times. One open invitation per company and email.
  - RLS: the company's admins and the platform admin read invitations; the token hash column is not readable; no user writes.
  - `create_company_invitation`, `revoke_company_invitation`, `get_company_invitation`, `accept_company_invitation`: service_role only, each checks its actor, each write is one audited transaction.
  - `list_company_members()`: the member list for the caller's company, for its active admins only.
  - `audit_log` accepts `company.member_invited`, `company.invitation_revoked`, `company.member_joined`.
- [x] `(company)` route group (Daylight): `/company/members` with the invite form, the members and the waiting invitations (with Withdraw). A 404 for anyone but a company admin.
- [x] `inviteMember` and `revokeInvitation` actions: strict schemas, company-admin check, rate limit `invite_user` 20/h (fails closed), the audited functions through the service client.
- [x] The invitation email (`inviteMail`) with the `/invite?token=…` link, sent by the app's mailer (10.4).
- [x] `/invite` (public): shows the invitation and one of four ways on.
  - No account for that email: choose a password; the account is made for the invited email, joins and is signed in.
  - An account exists, signed out: "Sign in to join"; sign-in returns to the invitation, pending accounts included.
  - Signed in with the invited email: "Join {company}".
  - Signed in with another email: told to sign out; no join button.
  - Used, withdrawn, expired and unknown links each say so.
- [x] Sign-in honours `next=/invite?…` for accounts that are not active yet; `/invite` and `/company` are in the redirect allowlist; `/invite` is a public path.
- [x] Workspace account menu: "Company: members" for company admins.
- [x] Tests:
  - pgTAP `company_invitations.test.sql` (41). `companies.test.sql` now counts only its own actor's audit rows.
  - `actions.test.ts` (8), `invite-actions.test.ts` (10), `members-screen.test.tsx` (7), sign-in and redirect tests.
  - e2e `company-invite.spec.ts` (3): a new person joins from the link, once; a pending account signs in from the link and joins, another account cannot; refusals, resend, withdraw, axe at 768 px.

## Dev Notes

- **D1, the link proves the address.** An account made through an invitation is created with its email already confirmed and needs no second email. The email always comes from the invitation, never from the form.
- **D2, joining activates.** A pending account that accepts becomes active (FR6: invited people are active at once). A deactivated account cannot join.
- **D3, opening the link uses nothing.** `/invite` only shows the invitation; the token is used on a button's POST, as with the other emailed links (mail scanners open links).
- **D4, only the token's hash is stored** (SHA-256 of 32 random bytes), so the database cannot be used to accept an invitation.
- **D5, no email, no invitation.** Without mail settings the invite is refused before anything is written; if the send fails the invitation is withdrawn, so the list shows only ones that went out.
- **D6, inviting an address again replaces the earlier link** (the old one shows as withdrawn).
- **D7, who is refused at invite time**: a member of this company, and a member of another company (the clear error of AC 2). Whether an address has an account is not shown to the admin.
- **D8, limits**: 20 invitations an hour per admin. Making an account from a link counts against the sign-up limits; there is no Turnstile on that form, since the link itself is the proof.
- **D9, the Company area is for company admins only.** Members and viewers get a 404; they have no member list yet.
- **D10, the admin's member list comes from a function**, not from wider profile access: colleagues' profiles stay readable only by their owner.
- **D11, invitations to several companies can be open at once** for one address; the first accepted wins and the others are refused when used.

Left for 10.7: changing roles and removing members.
