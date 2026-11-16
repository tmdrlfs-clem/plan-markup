# Story 10.10: Support lookup

Status: review

## Story

As the platform admin,
I want to look up a user's markup sets,
so that I can help with support questions.

## Acceptance Criteria

1. Given a user in admin, when I open Support lookup, then I see their markup sets by filename and page count only, with no access to drawing content that was not uploaded (FR15).
2. Each lookup is audit-logged.

## Tasks / Subtasks

- [x] Migration `20261123090000_support_lookup.sql`:
  - `public.admin_lookup_markup_sets(actor, user)`: service_role only; checks the actor; writes `audit_log` (`support.markup_sets_viewed`, with how many sets) and returns the sets in the same transaction.
  - Per set: the newest file's name and page count, the number of file versions, the number of live markups, created and last saved. No page, geometry, text or storage path.
- [x] `/admin/users/[userId]/support`: the account, a note that the lookup is recorded, and the table (file name, pages, markups, last saved).
  - 404 for an unknown or malformed id and for anyone but the platform admin.
- [x] "Markup sets" link on every row of `/admin/users` (a plain link, never prefetched).
- [x] Tests:
  - pgTAP `support_lookup.test.sql` (14): privileges; refusals record nothing; names and counts; no content and nobody else's set; every lookup recorded; an empty account; RLS still hides drawings and markups from the admin's own client.
  - `support-screen.test.tsx` (5).
  - e2e `support-lookup.spec.ts`: listing accounts records nothing; opening the lookup records one row, reloading a second; the markup's text is nowhere on the page; 404s; the user cannot open it; axe and 768 px.

## Dev Notes

- **D1, what a set shows.** File name and page count (the AC), plus the number of markups and when the set was last saved: counts and a time, which support needs to tell sets apart and to answer "did my work save?". No content.
- **D2, no way to the drawing.** The page has no link or button to open, download or preview anything, and the platform admin's own access (RLS) to drawings and markups is unchanged: none.
- **D3, a lookup is one page load.** Each load writes one audit row, a reload included; the read and the record are one transaction, so a lookup cannot happen unrecorded.
- **D4, the accounts list links with a plain link** so that nothing fetches the lookup ahead of a click.
- **D5, a set with several file versions shows the newest file** and says how many versions there are.
- **D6, deleted markups are not counted** here (the question is what the set holds now); the activity screen counts every markup created.
- **D7, at most 500 sets** are listed, the most recently saved first.
- **D8, no audit-log viewer yet.** The lookups are recorded; reading them back still needs the database.
