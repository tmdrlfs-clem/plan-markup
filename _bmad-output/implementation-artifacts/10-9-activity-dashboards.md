# Story 10.9: Activity dashboards

Status: done

## Story

As the platform admin or a company admin,
I want to see activity,
so that I know who is really using the product.

## Acceptance Criteria

1. Given `activity_events`, when I open Activity, then the platform admin sees per company and user: last active, markups saved (counted from `markups.created_at` by author, no extra event) and PDFs exported per week (FR14).
2. A company admin sees the same for their own company only (FR16).
3. No drawing content or client filenames are shown.

## Tasks / Subtasks

- [x] Migration `20261121090000_activity_summary.sql`:
  - `public.activity_summary(p_scope)`: one row per account with last active, markups saved (total and per week for four weeks) and PDFs exported (total and per week).
  - The caller is checked inside: `platform` needs an active platform admin, `company` an active company admin and returns their own company's members; anyone else gets no rows.
  - Indexes `markups (author_id, created_at)` and `activity_events (user_id, occurred_at desc)`.
- [x] `/admin/activity`: grouped by company with each company's totals; accounts in no company come last as "Individual accounts".
- [x] `/company/activity`: the members of the admin's own company under "Whole company".
- [x] Navigation: Activity in the admin and company areas (`AreaNav`).
- [x] Founder request (2026-11-16), "how much was used this week": migration `20261122090000_activity_summary_by_type.sql` adds, per week, days active, drawings worked on, prints and Place heads runs; the screen has two views.
  - **This week**: last active, days active (of 7), drawings, markups saved, PDFs exported, prints, head layouts. A company's row shows how many of its people were active.
  - **Four weeks** (`?view=weeks`): markups saved and PDFs exported week by week, with markups all time.
- [x] Tests:
  - pgTAP `activity_summary.test.sql` (17): week buckets; prints not counted as exports; last active; scopes; nobody else; deactivated admins; no title or file name in the result.
  - `activity-screen.test.tsx` (10): mapping, grouping, both screens, empty and "Never".
  - e2e `activity.spec.ts`: the platform admin sees both companies with totals; the company admin sees only their own; a member neither; the drawing's title is nowhere on either page; axe and 768 px.

## Dev Notes

- **D1, what the tables show.** This week by kind of work, and four weeks side by side for markups and PDFs (see the founder request above). Company rows carry the sums; for days active they show how many of the company's people were active.
- **D2, last active** is the latest of: sign-in, a saved markup, an export or a print. An account with none shows "Never".
- **D3, "PDFs exported" counts exports only** (editable and flattened); prints count towards last active but not here.
- **D4, markups saved counts every markup the person created**, including ones deleted later (FR14: counted from `markups.created_at` by author).
- **D5, weeks start on Monday, New Zealand time**, and the page says so.
- **D6, the company view is for company admins only**; members and viewers get a 404, as for the rest of the Company area. A platform admin who is not that company's admin does not get the company view either.
- **D7, counts and dates only.** The function reads no title, file name or markup content, and the tests check that none reaches the page.
- **D8, no date range or export yet**: the four-week window is fixed, and there is no CSV.
- **D10, everything comes from records that already exist**: saved markups and the export, print and Place heads events. Nothing new is tracked; time spent in the app and files merely opened are not recorded, so they are not shown.
- **D11, days active** are New Zealand dates with a saved markup or a recorded event. Signing in alone does not make a day active (only the last sign-in is known).
- **D12, drawings** are the different drawings a person saved markups on that week; a company's figure adds its people's up.
- **D9, pending and deactivated accounts are listed**, marked as such, so the totals are complete.
