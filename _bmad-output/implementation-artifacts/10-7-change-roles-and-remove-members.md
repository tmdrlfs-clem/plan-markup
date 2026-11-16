# Story 10.7: Change roles and remove members

Status: review

## Story

As a company admin,
I want to change roles and remove people,
so that access matches each person's job.

## Acceptance Criteria

1. Given company members, when I change a role (admin, member, viewer) or remove a member, then the change applies immediately and revokes the user's sessions (FR7, FR8, NFR17).
2. Removed users keep their own markup sets and fall back to individual use (FR8).
3. The last company admin cannot be removed or demoted.
4. Changes are audit-logged.

## Tasks / Subtasks

- [x] Migration `20261119090000_company_member_changes.sql`:
  - `public.set_company_member_role(actor, user, role)` and `public.remove_company_member(actor, user)`: service_role only; each checks the actor, locks the company, ends the member's Auth sessions and writes `audit_log` in one transaction.
  - Both refuse (PT409) to leave the company without an active admin.
  - `audit_log` accepts `company.member_role_changed` and `company.member_removed`.
- [x] `changeMemberRole` and `removeMember` actions: strict schemas, company-admin check, the audited functions through the service client.
- [x] Members table: a role select and Remove on every row.
  - Another member's role changes at once; Remove asks first and says the markup sets stay.
  - The admin's own row: the role change asks first; Remove reads "Leave". Either ends their session and goes to sign-in.
  - The only admin's controls are disabled, with the reason.
- [x] Tests:
  - pgTAP `company_member_changes.test.sql` (28).
  - `member-actions.test.ts` (6), `members-screen.test.tsx` (+5).
  - e2e `company-members.spec.ts` (2): role change signs the member out, last admin locked, an admin steps down and loses the Company area; removal signs out, the account stays active with its markup set; axe at 768 px.

## Dev Notes

- **D1, "last admin" means the last active admin.** An admin whose account is deactivated does not count as the one who remains.
- **D2, admins can change each other and themselves.** With another active admin left, an admin may demote or remove themselves ("Leave"); both ask first.
- **D3, every change ends the member's sessions**, role changes included (AC 1). They sign in again and get the new access. The same role again changes nothing and ends no session.
- **D4, removal deletes only the membership.** The account stays active and its markup sets are untouched: they are owned by the user, not the company (FR8). Rejoining needs a new invitation.
- **D5, another member's role changes without a confirmation**; the toast says they were signed out. Removal and one's own changes ask first.
- **D6, the audit row is on the company**, with the member's id and the roles in its detail.
- **D7, the screen locks the only admin's row by counting admins in the list**; the database is the judge, and its refusal is shown if the two disagree (for example when the other admin is deactivated).
