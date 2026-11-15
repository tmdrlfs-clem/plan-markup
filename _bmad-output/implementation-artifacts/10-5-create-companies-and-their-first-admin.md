# Story 10.5: Create companies and their first admin

Status: review

## Story

As the platform admin,
I want to create a company and assign its first admin,
so that a pilot company can manage its own people.

## Acceptance Criteria

1. Given the admin Companies screen, when I create a company and assign an existing user as its admin, then a migration creates `companies` and `company_members(role in admin|member|viewer)` with RLS helpers `app.fn_is_company_member()` and tests (FR11, AR5).
2. A user can belong to at most one company, enforced by a unique constraint (FR9).
3. The action is audit-logged.

## Tasks / Subtasks

- [x] Migration `20261117090000_companies.sql`:
  - `companies` (name 1–100 characters, trimmed, unique whatever its case).
  - `company_members` (user, company, role). The primary key is the user, so a user has at most one company.
  - Helpers `app.fn_is_company_member(company_id)` and `app.fn_is_company_admin(company_id)`, false for pending and deactivated users.
  - RLS: members read their own company and its members; the platform admin reads all; no user writes.
  - `audit_log` accepts `company.created` and the target type `company`.
  - `public.admin_create_company(actor, name, admin_email)`: one transaction that checks the actor, finds the account, creates the company and the admin membership and writes `audit_log`. EXECUTE is service_role only.
- [x] `/admin/companies`: the list (name, admins, member count, created) and the "New company" form (name, first admin's email).
  - Refusals appear on the field they are about, and focus moves there.
- [x] `createCompany` action: strict schema, platform-admin check, the audited function through the service client.
- [x] Admin navigation: Accounts and Companies, the current one marked.
- [x] Tests:
  - pgTAP `companies.test.sql` (30): privileges; refusals; create; one company per user and per name; roles; who reads what; helpers; account deletion.
  - `admin_user_status.test.sql` now counts only its own actor's audit rows (a local database keeps rows from e2e runs).
  - `company-actions.test.ts` (5), `companies-screen.test.tsx` (6).
  - e2e `admin-companies.spec.ts` (3): create with each refusal and the audit row; 404 for a company's own admin; axe and 768 px.

## Dev Notes

- **D1, the first admin is chosen by email.** The form takes the email of an existing account, matched whatever its case. There is no account picker yet.
- **D2, the first admin must be active.** A pending or deactivated account is refused with "Activate it under Accounts first". Creating a company never activates anyone.
- **D3, company names are unique**, ignoring case and outer spaces.
- **D4, one audit row per company**: `company.created`, with the name and the first admin's id in its detail.
- **D5, no rename, delete or member editing here.** Members come with invitations (10.6) and role changes (10.7). The list shows at most 200 companies, by name.
- **D6, the platform admin can be a company's first admin** like any other active account.
- **D7, deleting an account removes its membership**; the company stays, even with no admin left (the list says "No admin").

Found on the way:

- Form fields are read-only, not disabled, while saving: a disabled field cannot take the focus a refusal moves to it.
- A dev server whose shell was stopped kept running with stale modules and served the old navigation; it was stopped.
