# Story 10.11: Company tool sets

Status: done

## Story

As a company admin,
I want to publish tool sets to my company,
so that everyone uses the same symbols.

## Acceptance Criteria

1. Given one of my tool sets, when I publish it to the company, then all company users see it in the Tool Chest as a company set they can use but not edit (FR44).
2. RLS tests prove members cannot edit and non-members cannot read it.

## Tasks / Subtasks

- [x] Migration `20261124090000_company_tool_sets.sql`:
  - `tool_sets.company_id` (null for a personal set). Users cannot write it: INSERT and UPDATE on `tool_sets` are granted by column, without it.
  - RLS: a set published to a company, its tools and their images (`tool-assets`) are read by the company's active members; the write policies are unchanged (owner only).
  - `public.set_tool_set_published(actor, tool set, published)`: service_role only; checks that the actor is an active admin of a company and owns the set; writes `audit_log` (`company.tool_set_published` / `company.tool_set_withdrawn`, with the set's name) in the same transaction. At most 100 published sets per company.
  - Trigger on `company_members`: a set is withdrawn when its owner stops being an admin of that company (role change, removal).
- [x] `publishToolSet` server action (`src/features/tool-chest/actions.ts`); `listToolSets` returns the company's sets of other admins first (by name, `company: "shared"`), then the user's own (`company: "published"` when published). Every write in `src/lib/db/tool-sets.ts` names the caller's own sets.
- [x] Tool Chest: a Company mark on company sets; a set of someone else has Export only (no rename, move, delete, no double-click rename) and is not offered in Add to Tool Chest; a company admin has Publish / Withdraw on each of their own sets; deleting a published set says the company loses it.
- [x] Tests:
  - pgTAP `company_tool_sets.test.sql` (36): privileges; refusals record nothing; a member and a viewer read the set, its tools and images and can change none of them; another company's admin, someone in no company, the platform admin and a deactivated member read nothing; nobody writes `company_id`; publishing and withdrawing recorded once; withdrawn on demotion and removal.
  - Unit: `tool-set.test.ts`, `actions.test.ts`, `tool-chest-panel.test.tsx`.
  - e2e `company-tool-sets.spec.ts`: the admin imports and publishes a set; the member sees it marked Company with every tile drawn (the image one too) and Export only; an outsider sees nothing; withdrawing removes it for the member; both audit rows.

## Dev Notes

- **D1, published by reference, not copied.** The set stays the admin's own. They go on editing it and the company sees every change at the member's next load; there is no second copy to keep in step.
- **D2, only the owner publishes, withdraws and edits.** Another admin of the same company sees the set like a member does (use, export), and cannot withdraw it.
- **D3, a set leaves the company with its admin.** When the owner is demoted or removed, their published sets are withdrawn (they stay the owner's). The company keeps nothing of them; an admin who is about to leave can export the set for another admin to import and publish.
- **D4, every member reads company sets, viewers included.**
- **D5, members may export a company set** to a file (and so import it as their own copy).
- **D6, company sets come first in the Tool Chest,** by name, above the user's own sets; members cannot reorder or hide them.
- **D7, publishing asks no confirmation** (it is undone with one click); a toast names the company. Deleting a published set does ask, and says the company will lose it.
- **D8, at most 100 published sets per company.**
- **D9, publishing and withdrawing are audit-logged;** the withdrawal that follows a demotion or removal is not a separate row (the role change or removal is already recorded).
- **D10, Publish is in the Tool Chest,** on each of the admin's sets, not in the Company area.
- A member sees a newly published or withdrawn set after reloading the workspace: the Tool Chest loads once per visit.
