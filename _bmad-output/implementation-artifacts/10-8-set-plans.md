# Story 10.8: Set plans

Status: review

## Story

As the platform admin,
I want to set a plan on companies and individual users,
so that pilot and trial status is recorded before billing exists.

## Acceptance Criteria

1. Given a company or user in admin, when I set the plan field (trial, pilot, standard), then it is saved server-side only, audit-logged and never settable by users (FR13, NFR24).

## Tasks / Subtasks

- [x] Migration `20261120090000_plans.sql`:
  - `profiles.plan` and `companies.plan`: `trial` (default), `pilot` or `standard`, by a check.
  - `public.admin_set_plan(actor, target_type, target_id, plan)`: service_role only; checks the actor; one audited transaction.
  - `audit_log` accepts `user.plan_changed` and `company.plan_changed`.
  - Users cannot write either column: `profiles` grants update on name and theme only, `companies` has no write grant.
- [x] `setPlan` action: strict schema, platform-admin check, the audited function through the service client.
- [x] A Plan select on every row of `/admin/users` and `/admin/companies`; a change is saved at once.
- [x] Tests:
  - pgTAP `plans.test.sql` (22): defaults; privileges; refusals; user and company changes with their audit rows; users and company admins cannot write a plan.
  - `plan-actions.test.ts` (5), plan cases in `users-screen.test.tsx` and `companies-screen.test.tsx`.
  - e2e `admin-plans.spec.ts`: set an account to Pilot and a company to Standard, kept after reload, both recorded; axe and 768 px on both screens.

## Dev Notes

- **D1, the plan is a record.** Nothing is switched on or off by it yet; billing and limits come later.
- **D2, everyone starts on Trial**, accounts and companies alike.
- **D3, an account's plan is its own.** Someone in a company works under the company's plan; the accounts screen says so. The account's own plan is kept and applies again if they leave the company.
- **D4, a change is saved as soon as it is chosen**, with no confirmation: it is easy to set back and every change is recorded.
- **D5, users can read their own plan and their company's**, but there is no screen for it yet.
- **D6, the same plan again writes nothing**, as with status and roles.
