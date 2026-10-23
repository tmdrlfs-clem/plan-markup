---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - docs/4541-placement-design.md
  - docs/feature-inventory.md
  - docs/prior-art-sprinkler-drafter.md
---

# plan-markup - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for plan-markup, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Visitors can sign up with email and password; new accounts stay pending until activated by the platform admin. Users who sign up through a share invitation are activated automatically but can only open what was shared with them until the platform admin activates them fully. (M3/M4)
FR2: Users can sign in, sign out and reset their password by email. (M1/M3)
FR3: Users can use every workspace capability without belonging to a company. (M1)
FR4: Users can view and edit their own profile (name, email). (M3)
FR5: The system blocks all app and data access for unauthenticated or pending users. (M1)
FR6: Company admins can invite users to their company by email. (M3)
FR7: Company admins can assign and change the role of company users (admin, member, viewer). (M3)
FR8: Company admins can remove users from the company; removed users keep their own markup sets. (M3)
FR9: A user can belong to at most one company. (M3)
FR10: Viewers can view shared markup sets and change status / add comments, but cannot create or edit markups. (M4)
FR11: The platform admin can create companies and assign a company's first admin. (M3)
FR12: The platform admin can activate, deactivate and view any user account. (M3)
FR13: The platform admin can set the plan field (trial, pilot, standard) on companies and individual users. (M3)
FR14: The platform admin can view activity per company and user (last active, markups saved, PDFs exported per week). (M3)
FR15: The platform admin can look up a user's markup sets by filename and page count for support, without access to drawing content that was not uploaded. (M3)
FR16: Company admins can view activity for their own company. (M3)
FR17: Users can open a PDF from their computer; the file is not uploaded unless server storage is turned on for that drawing. (M1)
FR18: Users can open multiple PDFs in tabs and switch between them. (M1)
FR19: Users can navigate pages (next, previous, first, last, go to page) and via thumbnails. (M1)
FR20: Users can zoom, pan, fit page, fit width and rotate the view. (M1)
FR21: Users can search text in the PDF and jump to results. (M1)
FR22: Users can see page size, current scale and snap state in a status bar. (M1)
FR23: The system detects scale ratios printed on the drawing (including sheet-size qualifiers) and offers them for confirmation. (M1)
FR24: Users can calibrate a page by two known points or by ratio, for the current page, a page range or all pages, with an optional separate Y scale and chosen precision and units. (M1)
FR25: Users can verify a calibration against a known dimension. (M1)
FR26: Users can measure length, polylength, area, count, angle, radius and diameter; values display in calibrated units. (M1)
FR27: The system shows "Scale not set" instead of a value when measuring an uncalibrated page. (M1)
FR28: Users can create an area by dynamic fill (live spreading fill bounded by drawing lines, with brush add/erase and stroke undo) and see its area. (M1)
FR29: Users can snap points to drawing line endpoints, midpoints, intersections and edges, and constrain to horizontal/vertical/45°. (M1)
FR30: Users can view totals of measurements in a Measurements panel. (M1)
FR31: Users can draw pen, highlight, typewriter (text typed directly on the page without a box), line, arrow, polyline, polygon, rectangle, ellipse, cloud, cloud+, callout, text box, note, image and dimension markups. (M1)
FR32: Users can apply underline and strikethrough to PDF text. (M1)
FR33: Users can select (click, lasso), move, resize, rotate, copy/paste, delete, group/ungroup, align, reorder and lock markups. (M1)
FR34: Users can edit markup properties (colour, line width, fill, opacity, font, text, subject, layer) and copy formatting between markups. (M1)
FR35: Users can undo and redo markup actions. (M1)
FR36: Users can erase or white-out original drawing content non-destructively; the original stays intact until flatten/export. (M1)
FR37: Users can place a revision stamp showing revision number, date, author and description. (M1)
FR38: Users can insert an auto-generated legend listing the device symbols used on the page or document with their counts, which updates as symbols change. (M1)
FR39: Users can create, rename, reorder and delete personal tool sets. (M1)
FR40: Users can save any configured markup or symbol as a reusable tool, optionally typed as a device (group, label, description). (M1)
FR41: Users can place tools from the Tool Chest onto the drawing; device-typed placements are counted per device type. (M1)
FR42: Users can import a Revu `.btx` tool set file into a personal tool set. (M1)
FR43: Users can export and import tool sets in the product's own file format. (M1)
FR44: Company admins can publish company tool sets available to all company users; members can use but not edit them. (M3)
FR45: Users can see all markups in a list with subject, page label, comments, date, author, status, colour and layer. (M1)
FR46: Users can sort, filter and search the Markups List, and select a row to jump to the markup. (M1)
FR47: Users can set markup status and add comments to markups. (M4)
FR48: Users can export the Markups List and device counts to CSV. (M4)
FR49: The system saves markups to the user's account automatically, linked to the exact PDF file. (M1)
FR50: When a user reopens the identical PDF, the system restores its markups; a file changed outside the app opens as a new drawing. (M1)
FR51: Users can see a list of their markup sets (filename, pages, last modified) and open one. (M1)
FR52: Users can share a markup set with other registered users by email, granting edit or view, and revoke shares. (M4)
FR53: Users can turn on server PDF storage for a drawing, and remove the stored PDF from the server at any time. (M4)
FR54: Share recipients see the PDF with markups when server storage is on; otherwise they see markups on blank pages with the original filename and page count and can open their own copy. (M4)
FR55: The system records author, creation time, modification time and status changes for every markup. (M1/M4)
FR56: Users can insert pages from another PDF, insert blank pages, delete, extract, replace, rotate, reorder and crop pages; markups and calibration stay attached to their pages through these in-app edits (flattened or exported output files do not inherit the markup set). (M4)
FR57: Users can merge multiple PDFs into one. (M4)
FR58: Users can flatten all markups into the PDF content. (M1)
FR59: Users can flatten only filtered or selected markups, by markup type and page range, and allow later unflatten. (M4)
FR60: Users can export a PDF with non-flattened markups as standard PDF annotations editable in other PDF tools. (M1)
FR61: Users can export a flattened PDF. (M1)
FR62: Visitors can browse a public marketing site (features, use cases, pricing, security & privacy, FAQ). (M4)
FR63: Visitors can read a public help centre with how-to guides. (M4)
FR64: Search engines and AI assistants can crawl marketing and help pages, including structured data, sitemap and an llms.txt summary; app routes are excluded. (M4)
FR65: Visitors can request access / sign up from the marketing site. (M4)
FR66: Users can open the privacy policy and terms from the app and site. (M4)
FR67: Users can create, rename and delete markup layers, assign markups to a layer, and show/hide or lock each layer; hidden layers are excluded from print and export unless chosen. (M1)
FR68: Users can print the drawing with or without markups, choosing page range, fit-to-page or actual scale, and paper size. (M1)
FR69: The workspace uses the dark Blueprint theme by default; users can switch between Blueprint, Daylight (light) and High contrast in Settings → Appearance, and the choice is remembered. (M1)
FR70: Users can define zones on a calibrated page by dynamic fill or by drawing a polygon (any number of sides). (M2)
FR71: Users can assign an occupancy/use (e.g. office, kitchen, storage) to each zone; the system assigns the default hazard class (ELH, OH1, OH2, OH3) and its rule figures automatically. (M2)
FR72: Company admins can edit the default use → hazard class mapping for their company. (M3)
FR73: Users can run automatic head placement for one zone or all zones; the system places sprinkler heads within the rule figures (max area per head, min/max spacing, min/max wall distance) and optimises their positions, for rectangular and non-rectangular zones. (M2)
FR74: Users can set preferred wall distance and preferred head spacing within the rule limits per zone and re-run placement. (M2)
FR75: Users can toggle a coverage overlay that draws a translucent shape around each head so uncovered areas are visible, and switch the shape between circle and square. (M2)
FR76: Users can move, add or delete placed heads manually (e.g. to clear obstructions); placed heads behave as device symbols counted in the legend. (M2)
FR77: The system shows, per zone, hazard class, head count, area per head and any rule figure the current layout breaks, without blocking the user. (M2)
FR78: The system displays that layouts are advisory and the designer remains responsible for compliance, on screen and optionally in exports. (M2)
FR79: The platform admin can maintain the default rule figures for ELH, OH1, OH2 and OH3 and the default use → hazard mapping (seeded defaults in M2; admin editing in M3). (M2/M3)
FR80: The system records export and print events (time, user, markup set, page count — never drawing content) so activity metrics can count them. (M1)
FR81: When a user opens a PDF whose filename matches one of their markup sets but whose content differs, the system tells them markups exist on another version and offers to open their markup set list; markups are not moved. (M1)
FR82: When a user starts zone or measurement tools on an uncalibrated page, the system prompts them to confirm the detected scale or calibrate first. (M1)
FR83: Users can create a personal signature (drawn on screen or uploaded image), store it in their account, and place it on drawings as a signature stamp with their name and date. (M1)
FR84: Users can compare two PDFs (e.g. two revisions of a sheet), page by page, and see added, removed and changed content highlighted in distinct colours, with an option to cloud the differences as markups. (M4)

### NonFunctional Requirements

NFR1: First page of a 50 MB / A0 vector PDF is visible within 3 s on a mid-range laptop (4-core CPU, 16 GB RAM, Chrome).
NFR2: Pan and zoom sustain ≥30 fps (target 60 fps) with 500 markups on the current page.
NFR3: Placing, moving or editing a markup gives visual feedback within 50 ms; server save never blocks the UI.
NFR4: Markup save round-trip ≤500 ms at p95.
NFR5: Dynamic fill visibly spreads every animation frame and completes a typical room (≤100 m²) in ≤2 s of mouse hold.
NFR6: 4541 engine places heads for a single zone ≤200 m² in ≤1 s and a 600 m² floor of ≤15 zones in ≤5 s, without freezing the UI (runs off the main thread).
NFR7: Coverage overlay toggles within 100 ms.
NFR8: Measurements match the calibration exactly; values shown on screen and written to exported PDFs agree to the chosen precision.
NFR9: 4541 engine output is verifiable: every placed layout reports coverage, spacing, wall distance and area per head computed by the same rules used to place it; automated tests prove zero uncovered sample points for each named test zone (rectangle, L-shape, triangle, diagonal wall, corridor).
NFR10: `.btx` import reproduces ≥95% of the founder's 138 tool set items, judged per item by the criterion in Architecture Inputs A9.
NFR11: Server code identifies the user only from a server-verified token (Supabase `getUser()`/verified claims via a single `getAuthUser()` helper); `getSession()` or any client-supplied user id is never trusted for authorization. Raw calls are banned by lint.
NFR12: Authorization never reads `user_metadata` (user-editable). Roles, company and plan come from server-controlled data (`app_metadata` or database tables) only.
NFR13: Every server action, route handler and RPC re-checks authentication and authorization itself; middleware/proxy is a convenience, never the only gate.
NFR14: Passwords: minimum 12 characters, leaked-password check enabled, no maximum below 64; stored only by the auth provider.
NFR15: Login, sign-up, password reset and invitation endpoints are rate-limited per IP and per account, with bot protection (CAPTCHA) on sign-up and reset.
NFR16: Auth responses do not reveal whether an email exists (no account enumeration).
NFR17: Sessions use httpOnly, Secure, SameSite cookies with refresh-token rotation; idle timeout 7 days, absolute 30 days; deactivation, role change or password change revokes all of that user's sessions immediately.
NFR18: Email verification required before activation; password-reset and invitation links are single-use, expire (≤1 h reset, ≤7 days invite) and are bound to the target email.
NFR19: Redirect targets after login, reset and invite are restricted to an allowlist (no open redirect).
NFR20: Row-level security is enabled with default-deny on every table; a CI check fails the build if any table lacks RLS or policies. Access checks use shared helper functions, not inline JWT parsing.
NFR21: Every request that takes an id (markup set, tool set, share, company, user) verifies ownership or membership server-side (no IDOR); ids are UUIDs.
NFR22: `SECURITY DEFINER` functions set a fixed `search_path`, verify the caller inside the function, and have EXECUTE revoked from `anon`/`public`.
NFR23: The service-role key and other secrets exist only in server environment variables, never in client bundles or `NEXT_PUBLIC_*`; secret scanning runs on every push and `.env*` files are never committed.
NFR24: All server inputs are validated with schemas that whitelist fields; users cannot set protected fields (role, company_id, plan, owner, activated) through any endpoint (no mass assignment).
NFR25: Storage buckets for PDFs are private; access only via short-lived signed URLs (≤10 min) issued after an authorization check.
NFR26: PDFs are never transmitted to the server unless the user has enabled server storage for that drawing (verified by an automated test); deleting a stored PDF removes it from storage immediately and from backups on their next rotation.
NFR27: User text (markup text, comments, names, tool labels) is rendered as text, never as HTML; no `dangerouslySetInnerHTML` on user content.
NFR28: Strict Content-Security-Policy with nonces; HSTS, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy and Permissions-Policy headers on every response.
NFR29: State-changing requests are protected against CSRF (origin checks on route handlers; framework protection on server actions).
NFR30: PDF parsing runs in a worker with script evaluation disabled; PDF JavaScript and embedded actions are never executed.
NFR31: `.btx` and tool set import enforces file-size and decompressed-size limits (zip-bomb safe), disables XML external entities, and sanitises any SVG/appearance content before rendering.
NFR32: Error responses never expose stack traces, SQL or internal ids; logs never contain passwords, tokens or drawing content.
NFR33: Dependencies are pinned and audited in CI; high/critical vulnerabilities block release.
NFR34: Platform-admin and company-admin actions (activation, role/plan changes, removals, share revocations, rule-figure edits) are audit-logged with actor, target and time.
NFR35: All traffic over TLS 1.2+; data encrypted at rest; all server data hosted in an Australian or NZ region.
NFR36: A dedicated security review pass (separate from code review) is completed before the first pilot company and before each milestone release, covering the checklist above; findings rated High must be fixed before release.
NFR37: No markup is lost on refresh, crash or network drop: edits are queued locally and synced when the connection returns.
NFR38: Service availability ≥99.5% monthly (excluding announced maintenance).
NFR39: Daily database backups with point-in-time recovery of at least 7 days.
NFR40: MVP supports 50 companies / 500 users and 1 million markups without architectural change; per-page markup queries stay within NFR4.
NFR41: Exported PDFs open without errors in Adobe Acrobat, Bluebeam Revu and Chrome's PDF viewer; non-flattened markups remain editable in Acrobat and Revu.
NFR42: Supported browsers: latest 2 versions of Chrome and Edge (full), latest Firefox and Safari (best effort); minimum viewport 1280×720.
NFR43: Admin screens and marketing site meet WCAG 2.1 AA; workspace toolbars, panels and dialogs are keyboard reachable with visible focus.
NFR44: Marketing pages meet Core Web Vitals (LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms) and validate in Google's Rich Results Test.
NFR45: Geometry, scale, fill and 4541 engine logic live in framework-free modules with unit tests that run the shipped code; every fixed bug adds a named test.
NFR46: Front-end and server errors are reported to an error-tracking service from the first deployed build.
NFR47: CI checks schema drift, generated-type drift, lint, type-check and tests on every push.

### Additional Requirements

**Starter template (Epic 1 Story 1):** plain `create-next-app@latest` — `npx create-next-app@latest plan-markup-app --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-npm`, scaffolded into `plan-markup-app/` then moved to the `plan-markup/` repo root (root already holds `docs/`, `_bmad-output/`, `.claude/`). Then `@supabase/supabase-js@2.118.0 @supabase/ssr@0.12.7 zod@4.6.7 pdfjs-dist@6.4.299 @cantoo/pdf-lib@2.11.1 zustand@5.0.15 flatbush@4.6.2 rbush@4.0.1 idb@8.0.4 @sentry/nextjs@11.8.0 radix-ui@1.8.1 lucide-react@1.58.0`, dev `vitest@5.0.5 @playwright/test@1.64.1`, `supabase init` (CLI 2.121.0). TypeScript 7.0.2 — pin latest 6.x/5.x if Next/ESLint/Vitest are incompatible (decided in story 1).

- AR1: Repository structure per architecture step 6: `src/core/<domain>` framework-free (lint `no-restricted-imports`), `src/workers`, `src/features/<feature>`, `src/components/ui`, `src/lib`, `supabase/{migrations,tests,seed.sql}`, `fixtures/{pdf,btx,zones,private}` (private git-ignored), `e2e/`.
- AR2: Local dev: Supabase via Docker on custom ports (no clash with other local projects), `next dev` on a non-3000 port; `lib/env.ts` validates env; `.env.example` committed, `.env*.local` never.
- AR3: CI (GitHub Actions) from day 1: typecheck, lint, Vitest, Playwright smoke, migrations on local Supabase, schema-drift, `supabase gen types` drift (`src/lib/db/types.gen.ts`), RLS coverage check (fails if any table lacks RLS/policies), RLS matrix tests, gitleaks secret scan, `npm audit --audit-level=high` gate, oracle-independence check.
- AR4: Auth pattern: `@supabase/ssr` cookies, `src/proxy.ts` session refresh + route guards (Next 16), single `getAuthUser()` helper that verifies the token and checks `profiles.status = 'active'`; JWT expiry 10 min; deactivation/role/password change calls admin sign-out; custom claims namespaced, never overriding `role`; raw `getSession()`/`getUser()` banned by lint.
- AR5: RLS: default-deny on every table; helpers in schema `app` with `fn_` prefix (`app.fn_is_company_member()`, `app.fn_effective_access(drawing_id)` = min(role, grant)); SECURITY DEFINER RPCs with fixed `search_path`, internal caller check, EXECUTE revoked from anon/public; policies named `<table>_<action>_<who>`.
- AR6: Data model (shape): `companies`, `profiles`, `company_members(role)`, `drawings`, `drawing_files(sha256, pdfjs fingerprint, page_count, filename, parent_file_id, storage_path)`, `pages(page_id uuid, rotation, crop, size)`, `calibrations(page_id)`, `markups(id uuid v7, drawing_id, page_id, type, geometry jsonb, style jsonb, props jsonb, version, field_versions jsonb, deleted_at)`, `markup_events` (append-only), `tool_sets`, `tools`, `zones`, `zone_layouts(rule_figure_version, inputs, result, report)`, `rule_figures`, `use_hazard_map(company_id nullable)`, `shares`, `audit_log`, `activity_events`. Naming: plural snake tables, `fk_<table>_<ref>`, `idx_`/`uq_`, enums as text + CHECK, tombstone = `deleted_at`.
- AR7: Shared Zod v4 schemas in `src/core/schema/*` (discriminated union per markup type) used by client, workers and server; permissive UUID pattern; casing conversion only in `src/lib/db/*` mappers.
- AR8: Coordinates stored/computed in PDF user-space points (bottom-left origin); mm/m only at display and in rule tables; stable page ids (A2) bind markups and calibration through rotate/crop/page edits.
- AR9: File identity: SHA-256 of bytes computed in a worker in parallel with rendering (A1); pdf.js fingerprint as FR81 hint only; in-app page edits create a new `drawing_files` row linked by `parent_file_id`.
- AR10: Sync: commands → ops `{opId, markupId, kind, fields?, baseVersion, clientTs}` → IndexedDB queue (`idb`) → debounced (~300 ms) `apply_markup_ops(drawing_id, ops[])` RPC with field-level LWW, tombstones win, returns versions; retry with exponential backoff (cap 30 s), resume on `online`, `CONFLICT` → re-base and resend; undo of a synced change = compensating op (A4). Per-user rate limit on op writes.
- AR11: Realtime: Supabase Realtime channel `drawing:<id>` only for shared drawings that are open; incoming changes use the same op-apply path.
- AR12: Rendering: custom Canvas2D scene graph — PDF raster tiles from the render worker as `ImageBitmap` (tile cache in IndexedDB keyed by sha256+page+zoom bucket, eviction budget), static markups canvas, active/selection canvas, DOM overlays only for text editing.
- AR13: Editor store: one zustand vanilla store (slices `doc`, `view`, `tools`, `selection`, `history`); every document mutation is a command `{do, undo, label}`; no direct setState of document data from components.
- AR14: Three workers with typed messages `{type:'<domain>.<verb>', reqId, payload}` → `result|progress|error`, ArrayBuffers transferred: `render.worker` (pdf.js, `isEvalSupported:false`), `engine.worker` (hash, vector extraction, snap index, dynamic fill, 4541), `export.worker` (@cantoo/pdf-lib). Main thread never runs parsing, hashing, fill, snap-index build or placement (no main-thread task >50 ms).
- AR15: Spatial indexes: `flatbush` for per-page vector snap segments, `rbush` for markup hit-testing.
- AR16: Result shape everywhere `{ok:true,data} | {ok:false,code,message}` with stable codes (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL`); no `console.log` (logger wrapper); errors to Sentry without drawing content or client file names.
- AR17: Security headers: nonce-based CSP in `proxy.ts` for `(workspace)`, `(auth)`, `(admin)`; hash-based CSP for static `(marketing)`; HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy; worker-src self/blob.
- AR18: Bot protection: Cloudflare Turnstile via Supabase Auth CAPTCHA on sign-up and password reset.
- AR19: Storage: private buckets `drawings` (only when FR53 on, path `<company_or_user>/<drawing_id>/<sha256>.pdf`), `signatures` (`<user_id>/…`), `tool-assets` (`<owner_id>/<tool_set_id>/…`); signed URLs ≤10 min after an authorization check.
- AR20: Playwright test proves no PDF bytes leave the browser and no Storage call occurs while server storage is off (NFR26).
- AR21: Observability: Sentry (`@sentry/nextjs`) from first deploy incl. worker errors; `activity_events` named `<domain>.<past_verb>` without drawing content; admin actions to `audit_log`.
- AR22: Hosting: Vercel (functions `syd1`) + Supabase ap-southeast-2; environments local / preview / production; migrations via CI `supabase db push` on release; Supabase Pro + 7-day PITR before the first pilot company (M3 gate).
- AR23: Spikes first (A13), before feature stories: (1) `.btx` parse + render, (2) irregular placement + objective (Fable — prototype under way in `spikes/4541-placement/`), (3) A0 render + 500-markup fps on reference hardware (recorded in `fixtures/README.md`), (4) annotation export round-trip in Revu.
- AR24: 4541 engine per `docs/4541-placement-design.md`: placer and independent oracle in `src/core/sprinkler/{placer,oracle}` implemented by a Fable-model agent; oracle may not import placer (lint + CI); rule figures `nzs4541` v1 (`verified: true`) as versioned JSON mirrored to DB and seeded; Clipper2 binding chosen at the spike; §9.5 hooks (one `Barrier[]` input, per-head coverage polygons, ruleset schema with extra named tables and per-table `verified`).
- AR25: Export fidelity: `docs/export-mapping.md` (A5 table) plus manual Acrobat/Revu checklist; flatten via pdf-lib drawing onto original pages; unflatten via embedded markup data restorable in our app; white-out = visual cover (true removal post-MVP).
- AR26: Prototype modules (`C:\bluebeam\tool`: dynamic fill, scale detection, vector snap, geometry, export, legend) are refactored into `src/core/*` (globals → modules, render pixels → PDF points), not copied (A12); dynamic fill output stored as vector polygons (A11).
- AR27: Existing annotations in an opened PDF display read-only and are not imported (A3).
- AR28: Story splitting (A15): FR31, FR33, FR42, FR56 and FR73 are split per tool / per step.
- AR29: M2 gate baseline (A16): the founder times manual head placement on the same 3 drawings before running the engine.
- AR30: FR84 compare: design spike before M4 (vector diff by page id with raster fallback).

### UX Design Requirements

- UX-DR1: Design tokens in `src/app/globals.css` (`@theme`) for three themes under `[data-theme="blueprint"|"daylight"|"contrast"]`: surfaces 0–3, borders, text/muted, accent orange `#FF7A1A` (+ accent-fg), warning yellow `#F2D24B`, danger `#F04D5E`, success `#3FBF7F`, info `#6CA8FF`; near-sharp radii 2/3/4 px; hard offset shadows (no blur); `ring-2` accent focus; 4 px spacing base; z-layers. Exported once to `src/components/ui/tokens.ts` for the canvas renderer and re-read on theme change. Contrast pairs listed beside tokens and checked in CI.
- UX-DR2: Typography: Inter via `next/font` with tabular numerals for measurements; workspace scale 11/12/13/14/16 px, admin/marketing 14/16/20/24/32/40 px; weights 400/500/600.
- UX-DR3: Theme switching in Settings → Appearance (Blueprint default, Daylight, High contrast), stored in the user profile with local-storage fallback before login; admin and marketing use Daylight; sign-in and PendingActivation use Blueprint (user decision 2026-10-20).
- UX-DR4: Foundation components in `src/components/ui/*` wrapping Radix (`radix-ui` 1.8.1) with tokens: Button (primary/secondary/ghost/destructive), IconButton (tooltip = name + shortcut, `aria-keyshortcuts`), ToggleButton, ToggleGroup, Toolbar, Menu, MenuBar, ContextMenu, Dialog/AlertDialog, Popover, Tooltip, Tabs, Collapsible, Select, NumberField (units), Slider (always paired with NumberField), ColorSwatch, TextField, Checkbox, Panel (collapsible, resizable), StatusBarItem, Toast, Table (virtualised). lucide-react icons for chrome only.
- UX-DR5: WorkspaceLayout: 24 px menu bar (File, Edit, View, Document, Tools, Window, Settings, Help), 2-row toolbar (36 px rows), left 44 px icon rail + resizable panel (default 280, 220–420 px), canvas, right 44 px ToolRail, bottom Markups List (default 200 px, resizable), 24 px status bar; panel open/collapsed state remembered per user; landmarks; F6/Shift+F6 cycle regions.
- UX-DR6: ToolRail grouped Select/Pan · Markup · Measure · White-out · 4541; active = accent fill + shape change; disabled tools show why in tooltip; active tool persists until Esc (Revu behaviour); `role=toolbar`, roving focus, `aria-pressed`.
- UX-DR7: StatusBar fixed order: PagePager · ScaleIndicator · Snap toggles · cursor X/Y in real units · Zoom · SaveIndicator; `role=status` with polite announcements.
- UX-DR8: PagePager: first / previous / page input ("3 / 12") / next / last + sheet label; invalid input reverts silently; PageUp/PageDown/Home/End and Ctrl+←/→ when canvas focused.
- UX-DR9: ScaleIndicator states: `✓ Scale 1:100` (success), `Scale 1:100 detected — Verify` (warning), `⚠ Scale not set` (warning), mixed viewports; click opens CalibrateDialog.
- UX-DR10: SaveIndicator with the F2 states: `✓ Saved`, `Saving…`, `⚠ Offline — n changes waiting`, `✕ Not synced — Retry`, `Local only — Sign in to save`, plus toast `Updated from another device`; click → details popover (last saved, queued count, Retry).
- UX-DR11: HintBar under the toolbar for file-level notices (FR81 other version, image-only page, partial `.btx` import); info/warning/danger variants; one visible at a time; inline actions; dismissible; never covers the canvas.
- UX-DR12: CanvasViewport: pan (wheel, Space-drag, middle-drag; Ctrl toggles wheel zoom), zoom, per-tool cursor, hit-testing; states loading/ready/image-only/render error with tile retry; focusable with `aria-label` "Drawing canvas, page n of m"; arrows nudge selection (Shift ×10); selection summary mirrored to an off-screen live region.
- UX-DR13: SelectionHandles: accent outline + white halo, 8 resize + rotate handle (15° snap, Shift = 1°), vertex handles for polylines; Shift proportional, Alt from centre.
- UX-DR14: SnapGlyph in info blue with type: endpoint □, midpoint △, intersection ✕, on-line ○, perpendicular ⊥; text label on first use.
- UX-DR15: MeasureReadout: live value beside cursor while drawing; caption on finish (Shift+click moves caption separately); uncalibrated pages show "Scale not set" in warning colour, never a number.
- UX-DR16: First-run flow F1: empty workspace (drop zone + Open + recent files) → progressive render (tools enabled at first page) while hashing/scale detection run → status-bar "Scale 1:100 @ A1 detected — Verify" → Calibrate → first measure / Tool Chest stamp; no tour, one dismissible inline tip on first use of Calibrate, Tool Chest and 4541.
- UX-DR17: File identity messaging: same bytes → silent restore; same filename, different bytes → HintBar "Markups exist on another version of this file · Open markup set list"; in-app edited file → restore with version label in tab tooltip; never wording that suggests data loss.
- UX-DR18: CalibrateDialog: "Use detected 1:100 @ A1" or two-point calibrate; dialog collapses to a floating instruction bar ("Click the second point · Esc to cancel") while picking; asks real distance + unit; per page / range / all pages / viewport.
- UX-DR19: ToolChestPanel: collapsible sets, tool tiles (symbol preview + name), instant search, personal and company sets, Import .btx; tile states default/hover/armed/disabled (real-size symbols need calibration); click arms, drag places once. `.btx` import F7 result: all ok (toast "Sprinkler Tools — 66 tools"), partial (set added + per-item report dialog with reasons), invalid ("Not a Revu tool set file" — nothing changed).
- UX-DR20: MeasurementsPanel grouped by type with totals, units select, row click zooms; shares row component with Markups List.
- UX-DR21: ThumbnailsPanel virtualised with page number + sheet label, current page highlighted, context menu for rotate/insert/delete/reorder (drag).
- UX-DR22: PropertiesPanel context-aware (colour, line width, fill, opacity, font, caption, subject/label, layer); multi-select edits shared fields; changes apply immediately and are undoable.
- UX-DR23: LayersPanel: show/hide/lock, drag reorder, active layer for new markups.
- UX-DR24: 4541 panel (F3): uncalibrated state shows only "Calibrate this page first"; empty state checklist Zones ▢ Uses ▢ Place heads ▢ that ticks itself; ZoneList rows (name, use Select, hazard chip, area, head count, status ✓/⚠ n/✕ n/infeasible) synced with canvas; ZoneOptions collapsed (preferred spacing / wall distance sliders within limits, pattern rectangular/staggered, ceiling grid declaration); Place heads primary (selected or all) with per-zone progress ticks; re-run confirm states scope ("Re-place 2 zones, keep 3 edited heads"); ZoneReport (hazard, ruleset version, heads, area/head, max spacing, min/max wall distance, rule-break list); infeasible zone error card with reason + suggestion; advisory footer (FR78). Defaults-only path: fill → Place heads with zero further input.
- UX-DR25: CoverageOverlay: per-head polygons (circle default, square toggle), translucent info blue (~18 %), zone outline muted violet, uncovered area hatched; staged fade-in, instant under reduced motion; toggle ≤100 ms.
- UX-DR26: RuleBreakMarker: danger ✕ pin with short label ("Spacing 4.8 m > 4.6 m"), warning ⚠ pin for area per head; click zooms and selects the report row; live re-check while dragging heads.
- UX-DR27: LegendBox and RevisionStamp as canvas markups with live content (symbols + counts; rev, description, name, date), editable in Properties.
- UX-DR28: MarkupsList: virtualised grid (type icon, subject, label, page, author, date, status, layer, measurement value), sort, column filters + quick filter with removable chips and "Showing 24 of 312", multi-select synced with canvas, double-click zooms, editable status for reviewers; grid keyboard navigation.
- UX-DR29: Dialogs: FlattenDialog / ExportDialog (scope all/filtered/selected, page range, allow unflatten, include advisory notice; result toast "Exported … · Show in folder"), ShareDialog (email + Edit/View, existing shares, server-PDF toggle with plain explanation), SignaturePad (draw or upload, preview, save), CompareView (M4; side-by-side or overlay, added/removed/changed colours + legend, "Cloud differences").
- UX-DR30: Screens: EmptyWorkspace, PendingActivation ("Your account is waiting for approval" + what happens next), route ErrorBoundary ("Your markups are saved locally · Reload"), phone notice for shared links ("Open on a desktop to view and edit").
- UX-DR31: Special states (A14): image-only page info bar ("snapping and scale detection are unavailable; calibrate manually"); huge file page-by-page render with lazy thumbnails and memory warning only past the eviction budget; offline keeps everything working locally; skeleton rows in lists; no full-screen spinner after first load; every panel has a designed empty state naming the first action.
- UX-DR32: Button hierarchy: one primary per surface; secondary left / primary right; Enter = primary, Esc = cancel; verb labels; undoable deletes do not confirm (toast with Undo); irreversible actions confirm with scope; disabled buttons explain why.
- UX-DR33: Feedback placement: location issues on canvas + panel row; file issues in HintBar; system state in status bar; finished actions as toast (bottom-right, 4 s, pause on hover, max 3, identical merged with count); form errors inline under field; semantic colour always with icon + text; orange never a status colour.
- UX-DR34: Forms: NumberField accepts "4.6", "4600 mm", "4.6m", `15'6"`, normalises on blur, unit suffix, arrows step (Shift ×10); validate on blur and submit; submit focuses first error; workspace forms label-left 12 px, admin label-above 14 px; password ≥12 with show/hide.
- UX-DR35: Keyboard shortcut basic set = Revu default keys where the browser allows (full table in UX spec "Keyboard Shortcuts"), incl. V, Shift+V/Space, Z, +/-, Ctrl+9/Ctrl+0, Shift+Alt+L/Q/A/C, J, L, A, Shift+N, Shift+P, R, E, C, K, T, Q, P, H, S, Shift+W (white-out), Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (undo removes last point while drawing; placement run and flatten are one step), Ctrl+C/V/Shift+V, Del, Ctrl+A, Ctrl+G/Ctrl+Shift+G, Ctrl+Shift+]/Ctrl+[, Esc, Ctrl+O/S/Shift+S/P/F, Ctrl+Shift+M/U, Alt+X/P/T/U/Y/4/L, Shift+F4, modifiers (Shift constrain, Ctrl+Shift+drag copy, Shift+click caption, Enter/double-click finish, Backspace last point). Single-letter keys only with canvas focus; browser-reserved keys (Ctrl+Shift+N, Ctrl+Shift+D, Ctrl+N/T/W, Alt+D/E/F) not bound. Settings → Keyboard shortcuts lists the set (view-only).
- UX-DR36: Canvas interaction: click selects, Shift+click adds, marquee on empty space, selection synced with Markups List and Properties; every edit one undo step; undo history survives reload until the tab closes; locked/flattened content shows lock cursor + tooltip.
- UX-DR37: Responsive: workspace ≥1920 all panels; 1440–1919 left panel + Markups List open by default; 1280–1439 panels collapsed, opened panels overlay rather than shrinking canvas below 900 px, toolbar overflow into "More"; <1280 dismissible banner; height <800 Markups List collapsed; HiDPI canvas at devicePixelRatio within memory budget; browser zoom 80–150 % usable; container queries for panel resizes; custom breakpoints `sm 640, md 768, lg 1024, ws-min 1280, ws-md 1440, ws-lg 1920`. Admin ≥768 px; marketing mobile-first from 360 px.
- UX-DR38: Accessibility: WCAG 2.1 AA for admin/auth/marketing and workspace chrome; every canvas fact has a non-visual path (Markups List, ZoneReport, status bar); contrast ≥4.5:1 text and ≥3:1 for UI and canvas overlays against sheet and chrome in all three themes; never colour alone (shape differences ✕ vs ⚠, hatching for gaps); colour-vision simulation checks; `prefers-reduced-motion`; one polite and one assertive live region; hit targets 28 px workspace / 40 px admin / 44 px marketing mobile; UI text ≥11 px.
- UX-DR39: Accessibility and responsive testing: axe-core in Playwright on every route (CI fails on serious/critical); keyboard-only E2E for J1 core loop and J6 4541; viewport matrix 1280×720, 1440×900, 1920×1080, 2560×1440@2x; NVDA + Chrome spot checks per milestone.
- UX-DR40: Shared drawing for reviewer (F5) and sign-up (F6) flows: invited sign-ups active immediately in scope; recipients without server PDF see markups on blank pages plus "Open L3 RCP Rev C (4 pages) to view the drawing" → local open → hash match → full view; viewer mode hides drawing tools.

### FR Coverage Map

FR1: Epic 2 (Risk Spikes (A13)); Epic 10 (Accounts, Companies and Platform Administration)
FR2: Epic 1 (Secure Foundation and Sign-in) — sign in / sign out; Epic 10 (Accounts, Companies and Platform Administration) — password reset
FR3: Epic 1 (Secure Foundation and Sign-in)
FR4: Epic 10 (Accounts, Companies and Platform Administration)
FR5: Epic 1 (Secure Foundation and Sign-in)
FR6: Epic 10 (Accounts, Companies and Platform Administration)
FR7: Epic 10 (Accounts, Companies and Platform Administration)
FR8: Epic 10 (Accounts, Companies and Platform Administration)
FR9: Epic 10 (Accounts, Companies and Platform Administration)
FR10: Epic 11 (Sharing and Review)
FR11: Epic 10 (Accounts, Companies and Platform Administration)
FR12: Epic 10 (Accounts, Companies and Platform Administration)
FR13: Epic 10 (Accounts, Companies and Platform Administration)
FR14: Epic 10 (Accounts, Companies and Platform Administration)
FR15: Epic 10 (Accounts, Companies and Platform Administration)
FR16: Epic 10 (Accounts, Companies and Platform Administration)
FR17: Epic 3 (Open and Navigate Drawings)
FR18: Epic 3 (Open and Navigate Drawings)
FR19: Epic 3 (Open and Navigate Drawings)
FR20: Epic 3 (Open and Navigate Drawings)
FR21: Epic 3 (Open and Navigate Drawings)
FR22: Epic 3 (Open and Navigate Drawings)
FR23: Epic 4 (Calibrate and Measure)
FR24: Epic 4 (Calibrate and Measure)
FR25: Epic 4 (Calibrate and Measure)
FR26: Epic 4 (Calibrate and Measure)
FR27: Epic 4 (Calibrate and Measure)
FR28: Epic 4 (Calibrate and Measure)
FR29: Epic 4 (Calibrate and Measure)
FR30: Epic 4 (Calibrate and Measure)
FR31: Epic 5 (Markup and As-Built Drawing)
FR32: Epic 5 (Markup and As-Built Drawing)
FR33: Epic 5 (Markup and As-Built Drawing)
FR34: Epic 5 (Markup and As-Built Drawing)
FR35: Epic 5 (Markup and As-Built Drawing)
FR36: Epic 5 (Markup and As-Built Drawing)
FR37: Epic 7 (Tool Chest, Stamps and Legend)
FR38: Epic 7 (Tool Chest, Stamps and Legend)
FR39: Epic 7 (Tool Chest, Stamps and Legend)
FR40: Epic 7 (Tool Chest, Stamps and Legend)
FR41: Epic 2 (Risk Spikes (A13)); Epic 7 (Tool Chest, Stamps and Legend)
FR42: Epic 2 (Risk Spikes (A13)); Epic 7 (Tool Chest, Stamps and Legend)
FR43: Epic 7 (Tool Chest, Stamps and Legend)
FR44: Epic 10 (Accounts, Companies and Platform Administration)
FR45: Epic 6 (Auto-save, Markup Sets and Markups List)
FR46: Epic 6 (Auto-save, Markup Sets and Markups List)
FR47: Epic 11 (Sharing and Review)
FR48: Epic 11 (Sharing and Review)
FR49: Epic 6 (Auto-save, Markup Sets and Markups List)
FR50: Epic 6 (Auto-save, Markup Sets and Markups List)
FR51: Epic 6 (Auto-save, Markup Sets and Markups List)
FR52: Epic 11 (Sharing and Review)
FR53: Epic 11 (Sharing and Review)
FR54: Epic 11 (Sharing and Review)
FR55: Epic 6 (Auto-save, Markup Sets and Markups List) — author/created/modified; Epic 11 (Sharing and Review) — status changes
FR56: Epic 12 (Page Editing and Document Compare)
FR57: Epic 12 (Page Editing and Document Compare)
FR58: Epic 8 (Flatten, Export and Print)
FR59: Epic 12 (Page Editing and Document Compare)
FR60: Epic 2 (Risk Spikes (A13)); Epic 8 (Flatten, Export and Print)
FR61: Epic 8 (Flatten, Export and Print)
FR62: Epic 13 (Public Site and Help Centre)
FR63: Epic 13 (Public Site and Help Centre)
FR64: Epic 13 (Public Site and Help Centre)
FR65: Epic 13 (Public Site and Help Centre)
FR66: Epic 13 (Public Site and Help Centre)
FR67: Epic 5 (Markup and As-Built Drawing)
FR68: Epic 8 (Flatten, Export and Print)
FR69: Epic 3 (Open and Navigate Drawings)
FR70: Epic 9 (4541 Sprinkler Layout Engine)
FR71: Epic 9 (4541 Sprinkler Layout Engine)
FR72: Epic 10 (Accounts, Companies and Platform Administration)
FR73: Epic 2 (Risk Spikes (A13)); Epic 9 (4541 Sprinkler Layout Engine)
FR74: Epic 9 (4541 Sprinkler Layout Engine)
FR75: Epic 9 (4541 Sprinkler Layout Engine)
FR76: Epic 9 (4541 Sprinkler Layout Engine)
FR77: Epic 9 (4541 Sprinkler Layout Engine)
FR78: Epic 9 (4541 Sprinkler Layout Engine)
FR79: Epic 9 (4541 Sprinkler Layout Engine) — seeded defaults; Epic 10 (Accounts, Companies and Platform Administration) — admin editing
FR80: Epic 8 (Flatten, Export and Print)
FR81: Epic 6 (Auto-save, Markup Sets and Markups List)
FR82: Epic 4 (Calibrate and Measure)
FR83: Epic 5 (Markup and As-Built Drawing)
FR84: Epic 12 (Page Editing and Document Compare)

## Epic List

### Epic 1: Secure Foundation and Sign-in
A signed-in user reaches an empty Plan Markup workspace (menu bar, toolbars, rails, status bar, Blueprint tokens) on a secure base: project scaffold, Supabase auth with `getAuthUser()`, RLS default-deny, CI gates, security headers, Sentry. Accounts in M1 are created by the platform admin.
**FRs covered:** FR2 (sign in / sign out), FR3, FR5 · **Milestone:** M1

### Epic 2: Risk Spikes (A13)
The founder sees proof that the four riskiest technical bets work before feature stories depend on them: `.btx` parse + render, irregular-zone placement + objective (Fable; spike prototype exists in `spikes/4541-placement/`), A0 render + 500-markup fps on reference hardware, annotation export round-trip in Revu. Technical epic by founder decision (architecture A13).
**FRs covered:** none directly (de-risks FR42, FR73, NFR1–2, FR60/NFR41) · **Milestone:** before M1 features

### Epic 3: Open and Navigate Drawings
Users open PDFs from their computer (never uploaded), work in tabs, navigate pages and thumbnails, zoom/pan/fit/rotate, search text, read page size/scale/snap in the status bar, and switch between the three themes.
**FRs covered:** FR17, FR18, FR19, FR20, FR21, FR22, FR69 · **Milestone:** M1

### Epic 4: Calibrate and Measure
Users confirm a detected scale or calibrate, then measure length, polylength, area, count, angle, radius and diameter with snapping, dynamic fill and measurement totals; uncalibrated pages never show numbers.
**FRs covered:** FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30, FR82 · **Milestone:** M1

### Epic 5: Markup and As-Built Drawing
Users draw every MVP markup type (split per tool), select and edit markups, edit properties, undo/redo, white-out original content, organise layers and place a personal signature stamp.
**FRs covered:** FR31, FR32, FR33, FR34, FR35, FR36, FR67, FR83 · **Milestone:** M1

### Epic 6: Auto-save, Markup Sets and Markups List
Markups save automatically (offline queue, status-bar save states), reopen with the identical PDF, warn about other versions, list markup sets, and appear in a sortable, filterable Markups List with author/time history.
**FRs covered:** FR45, FR46, FR49, FR50, FR51, FR55 (author/created/modified), FR81 · **Milestone:** M1

### Epic 7: Tool Chest, Stamps and Legend
Users build personal tool sets, save configured markups as typed device tools, place them with counts, import Revu `.btx`, export/import their own format, and place revision stamps and an auto-updating legend.
**FRs covered:** FR37, FR38, FR39, FR40, FR41, FR42, FR43 · **Milestone:** M1

### Epic 8: Flatten, Export and Print
Users flatten markups, export editable or flattened PDFs that open in Acrobat/Revu/Chrome, and print with options; export and print events are recorded. Completes the M1 gate (5 days of as-built work without Revu).
**FRs covered:** FR58, FR60, FR61, FR68, FR80 · **Milestone:** M1 (gate)

### Epic 9: 4541 Sprinkler Layout Engine
Sprinkler designers define zones, assign uses → hazard classes, auto-place heads (placer + independent oracle by a Fable agent), tune preferences, view coverage, edit heads manually and read a per-zone rule report with the advisory notice; default rule figures are seeded.
**FRs covered:** FR70, FR71, FR73, FR74, FR75, FR76, FR77, FR78, FR79 (seeded defaults) · **Milestone:** M2

### Epic 10: Accounts, Companies and Platform Administration
Visitors sign up (pending activation), users manage profile and reset passwords, company admins invite and manage members, publish company tool sets and edit use → hazard mapping; the platform admin creates companies, activates users, sets plans, views activity and edits rule figures. Supabase Pro + 7-day PITR before the first pilot company.
**FRs covered:** FR1, FR2 (password reset), FR4, FR6, FR7, FR8, FR9, FR11, FR12, FR13, FR14, FR15, FR16, FR44, FR72, FR79 (admin editing) · **Milestone:** M3

### Epic 11: Sharing and Review
Users share markup sets by email (edit/view), optionally store the PDF on the server, viewers set status and comment, Markups List and device counts export to CSV, status history is recorded, and open shared drawings update in real time.
**FRs covered:** FR10, FR47, FR48, FR52, FR53, FR54, FR55 (status changes) · **Milestone:** M4

### Epic 12: Page Editing and Document Compare
Users edit pages (insert, delete, extract, replace, rotate, reorder, crop) with markups following their pages, merge PDFs, flatten selectively with unflatten, and compare two revisions with differences clouded on request.
**FRs covered:** FR56, FR57, FR59, FR84 · **Milestone:** M4

### Epic 13: Public Site and Help Centre
Visitors browse the marketing site and help centre, request access, and read privacy/terms; pages are crawlable by search engines and AI assistants (structured data, sitemap, llms.txt).
**FRs covered:** FR62, FR63, FR64, FR65, FR66 · **Milestone:** M4


## Epic 1: Secure Foundation and Sign-in

A signed-in user reaches an empty Plan Markup workspace on a secure base: project scaffold, Supabase auth with `getAuthUser()`, RLS default-deny, CI gates, security headers, Sentry. Accounts in M1 are created by the platform admin.

### Story 1.1: Scaffold the app with the pinned stack

As the founder,
I want the Plan Markup app scaffolded at the repo root with the agreed stack and boundaries,
So that every later story builds on the same versions, structure and rules.

**Acceptance Criteria:**

**Given** the `plan-markup/` folder already holds `docs/`, `_bmad-output/`, `.claude/` and `spikes/`
**When** `npx create-next-app@latest plan-markup-app --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-npm` is run and its files are moved to the repo root
**Then** `npm run dev` serves the default page on a non-3000 port and existing folders are untouched
**And** runtime and dev dependencies are installed at the exact versions in Additional Requirements (pinned, no `^`), with a recorded TypeScript decision (7.0.2 or latest 6.x/5.x if Next, ESLint typed rules or Vitest fail)
**And** the folder skeleton exists: `src/{core,workers,features,components/ui,lib}`, `supabase/`, `fixtures/{pdf,btx,zones,private}`, `e2e/`, with `fixtures/private/` and `.env*.local` git-ignored
**And** ESLint forbids React/Next/DOM/Supabase imports in `src/core/**`, forbids `src/core/sprinkler/oracle/**` importing `src/core/sprinkler/placer/**`, and forbids `console.*` (logger only)
**And** `src/lib/env.ts` validates required env with Zod and `.env.example` lists every variable
**And** Vitest runs one sample test in `src/core` and Playwright runs one smoke test against the dev server

### Story 1.2: CI quality gates

As the founder,
I want every push checked automatically,
So that broken builds, leaked secrets and vulnerable dependencies never reach main.

**Acceptance Criteria:**

**Given** a push or pull request on GitHub
**When** the `ci.yml` workflow runs
**Then** it runs `tsc --noEmit`, ESLint, Vitest and the Playwright smoke test, and fails on any error
**And** gitleaks scans the diff and fails on a detected secret; `.env*` files are rejected (NFR23)
**And** `npm audit --audit-level=high` fails the build on high/critical vulnerabilities and dependencies stay pinned (NFR33)
**And** a test asserts the oracle-independence lint rule is active (a fixture import from placer into oracle fails lint)
**And** the workflow status is visible on the pull request

### Story 1.3: Local Supabase with profiles and RLS baseline

As the founder,
I want a local Supabase stack with the first table under default-deny RLS and CI checks for it,
So that data access is secure from the first migration.

**Acceptance Criteria:**

**Given** Docker is running
**When** `supabase start` is run
**Then** the stack starts on custom ports that do not clash with other local projects (documented in README)
**And** a migration creates `profiles` (id = auth user id, name, email, `status` text CHECK in `pending|active|deactivated`, `is_platform_admin` boolean server-controlled, timestamps) with RLS enabled and policies `profiles_select_self`, `profiles_update_self` (name only)
**And** helper schema `app` exists with `app.fn_is_platform_admin()`; SECURITY DEFINER functions set `search_path` and revoke EXECUTE from `anon`/`public`
**And** `db.yml` CI starts Supabase, applies migrations, fails if any table lacks RLS or policies, fails on schema drift and on `supabase gen types` drift against `src/lib/db/types.gen.ts`, and runs RLS tests in `supabase/tests/` (a user cannot read another user's profile; anon reads nothing) (NFR20, NFR47)
**And** `seed.sql` creates a dev platform admin and a dev active user for local use only

### Story 1.4: Design tokens and themes

As a user,
I want a consistent, readable interface in the Blueprint theme with Daylight and High contrast available,
So that every screen looks like one product and is accessible from the first page.

**Acceptance Criteria:**

**Given** `src/app/globals.css`
**When** the app renders
**Then** tokens for Blueprint (default on `<html>`), Daylight and High contrast exist under `[data-theme]` with surfaces, borders, text, accent orange, warning `#F2D24B`, danger `#F04D5E`, success, info, radii 2/3/4 px, hard offset shadows, `ring-2` focus, 4 px spacing, z-layers and workspace/admin type scales (UX-DR1, UX-DR2)
**And** High contrast values are defined in this story (the UX spec drafts only Blueprint and Daylight)
**And** Inter loads via `next/font` with tabular numerals for numeric text
**And** `src/components/ui/tokens.ts` exports canvas-relevant tokens and notifies subscribers on theme change
**And** basic `Button` (primary / secondary / ghost / destructive) and `TextField` exist so the auth screens can use them
**And** a CI test checks listed contrast pairs for all three themes (≥4.5:1 text, ≥3:1 UI)

### Story 1.5: Sign in and sign out

As a user with an account created by the platform admin,
I want to sign in and sign out with email and password,
So that only I can reach my workspace.

**Acceptance Criteria:**

**Given** an active account
**When** I submit correct credentials on `/sign-in`
**Then** I land on the workspace and an httpOnly, Secure, SameSite session cookie is set via `@supabase/ssr`
**And** wrong credentials show one generic message that does not reveal whether the email exists (NFR16)
**And** login attempts are rate-limited per IP and account (NFR15)
**And** `getAuthUser()` in `src/lib/auth` verifies the token server-side and checks `profiles.status = 'active'`; raw `getSession()`/`getUser()` use is banned by lint (NFR11)
**And** `src/proxy.ts` refreshes the session and redirects unauthenticated requests on workspace routes to `/sign-in`, with post-login redirects restricted to an allowlist (NFR19)
**And** a pending or deactivated user who signs in sees the PendingActivation screen (styled with the Story 1.4 tokens) and cannot reach any workspace route or data (FR5)
**And** Sign out (from a minimal user menu) ends the session and returns to `/sign-in`
**And** JWT expiry is 10 minutes in Supabase config
**And** sessions use refresh-token rotation with an idle timeout of 7 days and an absolute lifetime of 30 days (NFR17)
**And** authorization never reads `user_metadata`; status and admin flags come from server-controlled data only (NFR12)
**And** every server action and route handler calls `getAuthUser()` itself; `proxy.ts` is never the only gate (NFR13)
**And** a platform-admin script (`npm run admin:create-user`) creates an active account for M1 pilots, server-side only with the service key

### Story 1.6: Security headers, error tracking and logging

As the founder,
I want strict security headers, error reporting and safe logging from the first deploy,
So that attacks are blocked and failures are visible without leaking data.

**Acceptance Criteria:**

**Given** any app response
**When** headers are inspected
**Then** workspace, auth and admin routes carry a nonce-based CSP from `proxy.ts` (worker-src self blob:, no unsafe-eval), and static marketing routes a hash-based CSP
**And** state-changing route handlers check `Origin`, and server actions rely on framework CSRF protection (NFR29)
**And** every response has HSTS, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, Referrer-Policy and Permissions-Policy (NFR28)
**And** `@sentry/nextjs` reports client, server and worker errors with drawing id only, never drawing content or client file names (NFR46, AR21)
**And** `src/lib/logger.ts` provides `debug/info/warn/error` gated by env, and error responses never contain stack traces or SQL (NFR32)
**And** each route group has an ErrorBoundary showing "Your markups are saved locally · Reload" (UX-DR30)
**And** a Playwright test asserts the headers on one route of each group

### Story 1.7: Foundation components

As a user,
I want menus, dialogs, tooltips and fields that behave the same everywhere,
So that the interface is predictable and fully keyboard accessible.

**Acceptance Criteria:**

**Given** the tokens from Story 1.4
**When** foundation components are built in `src/components/ui/*` as Radix (`radix-ui` 1.8.1) wrappers
**Then** IconButton (tooltip = name + shortcut, `aria-keyshortcuts`), ToggleButton, ToggleGroup, Toolbar, Menu, MenuBar, ContextMenu, Dialog, AlertDialog, Popover, Tooltip, Tabs, Collapsible, Select, NumberField, Slider paired with NumberField, ColorSwatch, Checkbox, Panel (collapsible, resizable), StatusBarItem and Toast exist, each with a Vitest + Testing Library test for keyboard and focus behaviour (UX-DR4)
**And** chrome icons use `lucide-react` 1.58.0 only
**And** Toast follows the feedback rules: bottom-right, 4 s, pauses on hover, max 3, identical toasts merge with a count; semantic colours always carry an icon and text and orange is never a status colour (UX-DR33)
**And** NumberField parses "4.6", "4600 mm", "4.6m" and `15'6"`, normalises on blur, shows the unit suffix and steps with arrows (Shift ×10) (UX-DR34)
**And** dialogs put secondary left / primary right, Enter = primary, Esc = cancel, and return focus to the trigger (UX-DR32)

### Story 1.8: Empty workspace shell

As a signed-in user,
I want to see the workspace layout with an inviting empty state,
So that I know where everything is and how to start, without needing a company.

**Acceptance Criteria:**

**Given** I am signed in (with or without a company, FR3)
**When** the workspace loads
**Then** I see the menu bar (File, Edit, View, Document, Tools, Window, Settings, Help), two toolbar rows, left 44 px icon rail with a collapsible resizable panel (220–420 px), right 44 px ToolRail, collapsible bottom panel and 24 px status bar (UX-DR5)
**And** the canvas area shows EmptyWorkspace: "Drop a PDF here or Open…" with an Open button and an empty recent-files list (UX-DR30)
**And** panel open/collapsed sizes are remembered per user (local storage until profile settings exist)
**And** F6 / Shift+F6 cycle regions; landmarks are set; all chrome is keyboard reachable with visible focus (NFR43)
**And** below 1280 px wide a dismissible banner says "Plan Markup is designed for screens 1280 px or wider" (UX-DR37)
**And** ToolRail buttons render disabled with a tooltip "Open a drawing first"
**And** Sign out moves into the File menu and the account menu

## Epic 2: Risk Spikes (A13)

The founder sees proof that the four riskiest technical bets work before feature stories depend on them. Each spike ends with a short report in `docs/spikes/` and a go / change decision.

### Story 2.1: Spike — `.btx` parse and render

As the founder,
I want to know that my Revu tool sets can be read and drawn faithfully,
So that the Tool Chest import (FR42) is feasible at ≥95 % fidelity.

**Acceptance Criteria:**

**Given** the founder's `.btx` files (Sprinkler Tools 66, Fire Alarm Tools 56, plus remaining sets = 138 items) copied to `fixtures/private/btx/`
**When** a prototype parser in `src/core/btx/` runs in a worker
**Then** it decodes the XML, hex + zlib values and the raw PDF annotation dictionaries with file-size and decompressed-size limits and no external entities (NFR31)
**And** each item renders to a canvas and is compared to a reference PNG exported from Revu with a pixel-diff threshold (A9)
**And** the report lists per-item pass/fail with reasons and the overall pass rate against the ≥95 % target (NFR10)
**And** a synthetic `.btx` sample (no client content) is committed to `fixtures/btx/` with a unit test

### Story 2.2: Spike close-out — irregular-zone placement (Fable)

As the founder,
I want the placement spike results confirmed and its decisions recorded,
So that Epic 9 starts from a proven algorithm and agreed rules.

**Acceptance Criteria:**

**Given** the existing prototype in `spikes/4541-placement/` (placer, independent oracle, 25 samples, demo)
**When** the Fable agent applies the 2026-10-17 column rule (columns block spray and need `Wmin`; `Wmax` does not apply to column faces) and reruns the suite
**Then** `node test/run.mjs` exits 0 with zero oracle errors on all feasible samples and located errors on infeasible ones
**And** the report records head counts vs hand counts and area lower bounds, timing for 200 m² zones (≤1 s), known weak cases (large multi-column floors, staggered +1 head, tile-alignment spacing skew) and the deviations from the design doc
**And** the Clipper2 JS binding (or the spike's own geometry kernel) is chosen and pinned for Epic 9
**And** the sample zones are exported to `fixtures/zones/*.json` for reuse

### Story 2.3: Spike — A0 render and 500-markup frame rate

As the founder,
I want proof that huge vector drawings render fast and stay smooth with many markups,
So that NFR1 and NFR2 are achievable with the chosen render architecture.

**Acceptance Criteria:**

**Given** the reference hardware (4-core CPU, 16 GB RAM, Chrome) and named fixtures (founder's L17/L21 RCPs and a 50 MB A0 vector PDF) recorded in `fixtures/README.md`
**When** a prototype render worker (pdf.js, `isEvalSupported: false`) produces `ImageBitmap` tiles and a Canvas2D layer draws 500 synthetic markups
**Then** the first low-resolution frame appears in ≤3 s (NFR1, A10)
**And** pan and zoom sustain ≥30 fps (target 60) with 500 markups on the page (NFR2)
**And** no main-thread task exceeds 50 ms during open, pan and zoom (Performance panel trace attached)
**And** the report recommends tile size, zoom buckets and the tile-cache eviction budget

### Story 2.4: Spike — annotation export round-trip in Revu

As the founder,
I want exported markups to open and stay editable in Revu and Acrobat,
So that FR60 and NFR41 are achievable with `@cantoo/pdf-lib`.

**Acceptance Criteria:**

**Given** a sample PDF and one markup of each MVP type (incl. cloud+, dimension, calibrated measurements, dynamic fill area, white-out, device stamp, group, layer)
**When** a prototype in `src/core/export/` writes them as native annotations, appearance-only annotations or flattened content
**Then** the output opens without errors in Revu 21, Acrobat and Chrome
**And** a manual checklist records per type whether it is visible, editable and keeps its measurement value in Revu and Acrobat
**And** `docs/export-mapping.md` holds the A5 table (type → native / appearance-only / forced flatten) based on the results
**And** a flattened export of the same set matches the on-screen rendering visually

## Epic 3: Open and Navigate Drawings

Users open PDFs from their computer (never uploaded), work in tabs, navigate pages and thumbnails, zoom/pan/fit/rotate, search text, read page size/scale/snap in the status bar, and switch between the three themes.

### Story 3.1: Open a local PDF and see the first page fast

As a drafter,
I want to open a PDF from my computer and see the drawing almost immediately,
So that I can start work without waiting or uploading anything.

**Acceptance Criteria:**

**Given** the empty workspace
**When** I drop a PDF or choose File → Open (`Ctrl+O`)
**Then** the file is read locally and rendered by `render.worker` (pdf.js, `isEvalSupported: false`, PDF JavaScript and actions never executed) into `ImageBitmap` tiles drawn on the canvas (FR17, AR12, AR14, NFR30)
**And** a low-resolution first frame appears within 3 s for the named A0 fixture on reference hardware, then sharpens progressively (NFR1, A10)
**And** no request body contains PDF bytes and no Storage call occurs (Playwright test, NFR26, AR20)
**And** annotations already in the PDF are displayed read-only as part of the page (AR27)
**And** a page with no vector or text content shows the HintBar info "This page is an image — snapping and scale detection are unavailable; calibrate manually" (UX-DR31)
**And** a corrupt or password-protected file shows an inline error with what to do, and the workspace stays usable
**And** the canvas has `aria-label` "Drawing canvas, page n of m", is focusable, has states loading / ready / image-only / render error (failed tiles show a placeholder with retry), and a thin progress bar shows in the tab while loading (UX-DR12)

### Story 3.2: Zoom, pan, fit and rotate the view

As a drafter,
I want to move around the drawing the way I do in Revu,
So that navigating a large sheet feels instant.

**Acceptance Criteria:**

**Given** an open drawing
**When** I scroll, hold `Space` and drag, middle-drag, use the Pan tool (`Shift+V`), press `+`/`-`, use the Zoom tool (`Z`), hold `Ctrl` with the wheel, or choose Fit page (`Ctrl+9`) / Fit width (`Ctrl+0`) / Rotate view
**Then** the view updates with ≥30 fps (target 60) and tiles re-render for the new zoom bucket without blocking input (FR20, NFR2)
**And** `Space` pans temporarily without leaving the active tool; browser zoom reset is suppressed only while the canvas has focus
**And** rendering uses `devicePixelRatio` within the tile memory budget; hairlines stay one device pixel (UX-DR37)
**And** the tile cache is stored in IndexedDB keyed by sha256 + page + zoom bucket with an eviction budget; exceeding it shows a memory warning only then (AR12, UX-DR31)
**And** no main-thread task exceeds 50 ms during pan/zoom (A10)

### Story 3.3: Page pager and page keys

As a drafter,
I want to move between pages from the status bar and keyboard,
So that I always know where I am in a multi-page set.

**Acceptance Criteria:**

**Given** a multi-page drawing
**When** I use first / previous / next / last, type a page number, or press `PageUp`/`PageDown`/`Home`/`End`/`Ctrl+←`/`Ctrl+→` with canvas focus
**Then** the page changes and the pager shows "3 / 12" plus the sheet label (page label or detected sheet number) (FR19, UX-DR8)
**And** an invalid page number reverts silently; arrows are disabled on a single-page file
**And** the page change is announced in the polite live region

### Story 3.4: Thumbnails panel

As a drafter,
I want page thumbnails in the left panel,
So that I can jump to a sheet visually.

**Acceptance Criteria:**

**Given** an open drawing
**When** I open Thumbnails (left rail or `Alt+T`)
**Then** a virtualised list shows each page thumbnail with page number and sheet label, rendered lazily by the render worker (UX-DR21)
**And** the current page is highlighted and clicking a thumbnail navigates to it
**And** the panel has a designed empty state when no drawing is open

### Story 3.5: Multiple drawings in tabs

As a drafter,
I want several PDFs open in tabs,
So that I can compare and switch between sheets quickly.

**Acceptance Criteria:**

**Given** one drawing is open
**When** I open another PDF
**Then** it opens in a new document tab and I can switch tabs by click or keyboard, each keeping its own page, zoom and tool state (FR18)
**And** closing a tab frees its render resources; the last closed tab returns to EmptyWorkspace
**And** the tab tooltip shows the full filename

### Story 3.6: Search text in the drawing

As a drafter,
I want to search text on the drawing,
So that I can find room names, notes and tags fast.

**Acceptance Criteria:**

**Given** a drawing with a text layer
**When** I press `Ctrl+F` with canvas focus and type a query
**Then** a hit list appears in a panel, hits are highlighted on the canvas and `Enter` / `Shift+Enter` move to next / previous, panning and zooming to each (FR21)
**And** an image-only page reports "No searchable text on this page"
**And** text extraction runs in a worker and never blocks the canvas

**Follow-up (post-3.x, founder 2026-10-24, not scheduled):** "Search all open drawings" — a Search panel option that searches every open document tab (Revu's "all open documents"), results grouped by drawing then page. Deferred from the 3.6 review; the per-tab `DocumentSearch` engines can be queried together when it is picked up.

### Story 3.7: Status bar with page size, scale, snap, cursor and zoom

As a drafter,
I want the status bar to show page facts at a glance,
So that I can trust what I measure and see.

**Acceptance Criteria:**

**Given** an open drawing
**When** I move the cursor or change page/zoom
**Then** the status bar shows, in order, pager · ScaleIndicator · snap toggles · cursor X/Y · zoom % · save area, and the page size (e.g. "A1 841 × 594 mm") in a tooltip or item (FR22, UX-DR7)
**And** ScaleIndicator shows `⚠ Scale not set` in the warning colour with icon until calibration exists (UX-DR9)
**And** cursor X/Y shows PDF units until the page is calibrated
**And** the region is `role=status` and changes are announced politely

### Story 3.8: Appearance themes

As a user,
I want to choose Blueprint, Daylight or High contrast,
So that the workspace suits my eyes and my room.

**Acceptance Criteria:**

**Given** Settings → Appearance from the menu bar
**When** I pick a theme
**Then** chrome and canvas overlays switch immediately without reload; Blueprint is the default (FR69, UX-DR3)
**And** the choice is stored on my profile (`profiles.theme`, migration in this story with RLS self-update) and falls back to local storage before sign-in
**And** contrast checks pass for all three themes

## Epic 4: Calibrate and Measure

Users confirm a detected scale or calibrate, then measure with snapping, dynamic fill and totals; uncalibrated pages never show numbers.

### Story 4.1: Snap to drawing linework

As a drafter,
I want my clicks to snap to the lines of the drawing,
So that measurements and markups land exactly on geometry.

**Acceptance Criteria:**

**Given** an open vector page
**When** the page loads
**Then** `engine.worker` extracts vector segments (refactored from the prototype into `src/core/snap`, PDF points, A12) and builds a `flatbush` index without blocking the main thread (AR14, AR15)
**And** while a drawing or measuring tool is active, the cursor snaps to endpoints □, midpoints △, intersections ✕, on-line ○ and perpendicular ⊥ with the info-blue SnapGlyph and a text label on first use (FR29, UX-DR14)
**And** snap toggles (content / markup / grid) in the status bar turn snapping on/off, remembered per user
**And** holding `Shift` constrains to 0/45/90°
**And** unit tests run the shipped `src/core/snap` functions on fixture segments (NFR45)

### Story 4.2: Detect printed scales

As a drafter,
I want the app to find the scale printed on the drawing,
So that I only need to confirm it.

**Acceptance Criteria:**

**Given** an opened page with text
**When** scale detection runs in `engine.worker` (refactored from the prototype)
**Then** ratios like "1:100 @ A1" or "SCALE 1:50" including sheet-size qualifiers are found and the status bar shows "Scale 1:100 @ A1 detected — Verify" in the warning colour (FR23, UX-DR9)
**And** pages with several viewport scales show "2 scales on page"
**And** "As indicated" title blocks do not produce a false scale (founder's L17/L21 fixtures)
**And** unit tests cover detection on fixture text runs

### Story 4.3: Calibrate a page

As a drafter,
I want to calibrate by ratio or by two known points,
So that every measurement is in real units.

**Acceptance Criteria:**

**Given** the CalibrateDialog (from ScaleIndicator or Document → Calibrate)
**When** I choose "Use detected 1:100 @ A1", enter a ratio, or pick two points (dialog collapses to "Click the second point · Esc to cancel") and type the real distance and unit
**Then** the calibration applies to the current page, a page range or all pages, with optional separate Y scale, chosen precision and units (FR24, UX-DR18)
**And** calibration is held per stable page id in the document state (AR8) and persisted with the markup set when Epic 6 adds saving
**And** the status bar shows `✓ Scale 1:100` in success colour and cursor X/Y switches to real units
**And** the action is one undo step
**And** first-run flow F1 holds: tools work as soon as the first page renders, and the first use of Calibrate shows one dismissible inline tip (no tour) through a reusable first-use tip helper (UX-DR16)

### Story 4.4: Verify a calibration

As a drafter,
I want to check the scale against a dimension I know,
So that I trust the numbers before I rely on them.

**Acceptance Criteria:**

**Given** a calibrated page
**When** I choose Verify and pick two points of a known dimension
**Then** the dialog shows the measured value and the difference from the entered known value, with options to keep or recalibrate (FR25)
**And** the value uses the chosen precision and matches the calibration exactly (NFR8)

### Story 4.5: Draw a length measurement (editor foundation)

As a drafter,
I want to measure a straight length,
So that I can read real distances off the drawing.

**Acceptance Criteria:**

**Given** a calibrated page
**When** I choose Length (`Shift+Alt+L`) and click two points (`Esc` cancels)
**Then** the live value shows beside the cursor and the finished measurement shows its value (FR26, UX-DR15)
**And** this story introduces the editor foundations: zustand vanilla store with slices `doc/view/tools/selection/history`, command objects `{do, undo, label}`, the Zod markup schema (discriminated union, PDF points) and the static/active canvas layers (AR7, AR8, AR12, AR13)
**And** `Ctrl+Z` / `Ctrl+Y` (also `Ctrl+Shift+Z`) undo and redo finished measurements; the tool stays active until `Esc` (FR35, UX-DR6, UX-DR35)
**And** the undo history is serialised per browser tab (sessionStorage) so it survives a reload until the tab closes (UX-DR36)
**And** placing gives visual feedback within 50 ms (NFR3)
**And** values come from `src/core/measure` with unit tests (NFR8, NFR45)

### Story 4.6: Polylength and measurement captions

As a drafter,
I want multi-segment lengths and movable captions,
So that I can measure pipe runs and keep labels readable.

**Acceptance Criteria:**

**Given** the length tool from Story 4.5
**When** I choose Polylength (`Shift+Alt+Q`) and click points (double-click / `Enter` finishes, `Backspace` or `Ctrl+Z` removes the last point, `Esc` cancels)
**Then** the live total shows beside the cursor and a caption appears on finish (FR26, UX-DR15)
**And** `Shift+click` on a caption moves it separately from the measurement
**And** caption style follows the markup style and the chosen precision and units

### Story 4.7: Prompt for scale and never show unscaled numbers

As a drafter,
I want the app to stop me measuring on an unknown scale,
So that I never copy a wrong number.

**Acceptance Criteria:**

**Given** an uncalibrated page
**When** I start a measurement or zone tool
**Then** a prompt offers "Detected 1:100 @ A1 — Use it / Calibrate…" (or only Calibrate when nothing was detected) (FR82)
**And** if I dismiss it, measurements show "Scale not set" in the warning colour instead of any number (FR27, UX-DR15)

### Story 4.8: Area and count measurements

As a drafter,
I want to measure areas and count items,
So that I can quantify rooms and devices.

**Acceptance Criteria:**

**Given** a calibrated page
**When** I use Area (`Shift+Alt+A`) by clicking a polygon, or Count (`Shift+Alt+C`) by clicking items
**Then** the area value (and perimeter in the caption details) or running count displays in calibrated units (FR26)
**And** area polygons snap and constrain like length; count markers are one markup with a count property
**And** unit tests cover polygon area with holes and self-intersection rejection

### Story 4.9: Angle, radius and diameter measurements

As a drafter,
I want angle, radius and diameter tools,
So that I can measure splays and round elements.

**Acceptance Criteria:**

**Given** a calibrated page
**When** I use Angle (three points), Radius or Diameter (circle by points)
**Then** values display with the chosen precision and units; angles in degrees (FR26)
**And** the tools follow the same finish/cancel/undo rules as length

### Story 4.10: Dynamic fill area

As a drafter,
I want to press and hold inside a room to fill it,
So that I get a room area without clicking every corner.

**Acceptance Criteria:**

**Given** a calibrated vector page
**When** I choose Dynamic fill (`J`) and press and hold inside a room
**Then** the fill visibly spreads every animation frame, bounded by drawing lines, and a typical room (≤100 m²) completes within 2 s of holding (FR28, NFR5)
**And** brush add/erase and stroke undo adjust the fill
**And** the result is stored as vector polygons, not a raster mask (A11), with its area displayed
**And** a fill that leaks outside the room shows guidance and the manual polygon tool remains available
**And** the fill logic is refactored from the prototype into `src/core/fill` with unit tests (A12, NFR45)

### Story 4.11: Measurements panel

As a drafter,
I want totals of my measurements in one place,
So that I can read quantities without adding them up.

**Acceptance Criteria:**

**Given** measurements on the drawing
**When** I open Measurements (left rail or `Alt+U`)
**Then** measurements are grouped by type with per-group totals in the chosen units, and clicking a row zooms to and selects the measurement (FR30, UX-DR20)
**And** the panel shows an empty state naming the measure tools when none exist

## Epic 5: Markup and As-Built Drawing

Users draw every MVP markup type, select and edit markups, edit properties, undo/redo, white-out original content, organise layers and place a personal signature stamp. FR31 and FR33 are split per tool / per operation (A15).

### Story 5.1: Select, move and delete markups

As a drafter,
I want to select markups and move or delete them,
So that I can fix mistakes quickly.

**Acceptance Criteria:**

**Given** markups on the page
**When** I use Select (`V`): click, `Shift+click` to add, marquee on empty space, arrows to nudge (`Shift` ×10), `Del`/`Backspace` to delete, `Ctrl+A` to select all
**Then** lasso (freeform) selection is also available, and hit-testing uses an `rbush` index and selected markups show the accent outline with white halo (FR33, AR15, UX-DR13, UX-DR36)
**And** delete is undoable and shows a toast with Undo instead of a confirmation (UX-DR32)
**And** each move or delete is one undo step and undo/redo covers every markup command; undo history survives reload until the tab closes (FR35, UX-DR36); locked markups show a lock cursor and tooltip

### Story 5.2: Resize, rotate, copy and paste

As a drafter,
I want to resize, rotate and duplicate markups,
So that I can reuse and adjust them.

**Acceptance Criteria:**

**Given** a selected markup
**When** I drag resize handles (`Shift` proportional, `Alt` from centre), the rotate handle (15° snap, `Shift` = 1°), vertex handles on polylines, or use `Ctrl+C` / `Ctrl+V` / `Ctrl+Shift+V` (paste in place) / `Ctrl+Shift+drag`
**Then** the markup updates with feedback within 50 ms and each action is one undo step (FR33, NFR3)
**And** paste places at the cursor; paste in place keeps coordinates; `Ctrl+Shift+drag` copies along a straight line

### Story 5.3: Group, align, reorder and lock

As a drafter,
I want to group, align, reorder and lock markups,
So that complex markups stay tidy and safe.

**Acceptance Criteria:**

**Given** selected markups
**When** I use Group `Ctrl+G` / Ungroup `Ctrl+Shift+G`, align (6 directions), Bring to front `Ctrl+Shift+]` / Send backward `Ctrl+[`, or Lock from the context menu
**Then** the operation applies and is undoable (FR33)
**And** locked markups cannot be moved or edited until unlocked

### Story 5.4: Line, arrow, polyline and polygon tools

As a drafter,
I want straight-line markups,
So that I can draw pipework and outlines.

**Acceptance Criteria:**

**Given** an open drawing
**When** I choose Line (`L`), Arrow (`A`), Polyline (`Shift+N`) or Polygon (`Shift+P`) and click points
**Then** the markup is created with snapping, `Shift` constrain, `Backspace`/`Ctrl+Z` removing the last point, double-click/`Enter` finishing and `Esc` cancelling (FR31, UX-DR35)
**And** each type has its Zod schema and renderer, and the tool stays active until `Esc`

### Story 5.5: Rectangle, ellipse and cloud tools

As a drafter,
I want box, ellipse and revision cloud markups,
So that I can highlight areas of change.

**Acceptance Criteria:**

**Given** an open drawing
**When** I choose Rectangle (`R`), Ellipse (`E`) or Cloud (`C`) and drag or click points
**Then** the markup is created with style defaults (colour, width, fill, opacity); cloud arc size is fixed in page units and redrawn at every zoom (FR31)

### Story 5.6: Text box, callout, typewriter, note and cloud+

As a drafter,
I want text markups,
So that I can annotate changes in words.

**Acceptance Criteria:**

**Given** an open drawing
**When** I choose Text box (`T`), Callout (`Q`), Typewriter, Note or Cloud+ (`K`, cloud with leader and text)
**Then** a DOM text editor overlays the canvas while typing and the result renders on the canvas; text is stored and rendered as plain text, never HTML (FR31, NFR27)
**And** single-letter shortcuts are ignored while typing in the editor; `Esc` ends editing

### Story 5.7: Pen and highlight tools

As a drafter,
I want freehand pen and highlighter,
So that I can mark quickly by hand.

**Acceptance Criteria:**

**Given** an open drawing
**When** I choose Pen (`P`) or Highlight (`H`) and drag
**Then** a smoothed freehand path is created; holding `Shift` draws straight horizontal/vertical strokes (FR31)
**And** highlight renders at 40 % opacity with a multiply blend over the sheet

### Story 5.8: Image and dimension markups

As a drafter,
I want to place images and dimension lines,
So that I can add photos and dimensioned notes.

**Acceptance Criteria:**

**Given** an open drawing
**When** I insert an image file (PNG/JPEG, size-limited, decoded safely) or draw a Dimension
**Then** the image is placed at a sensible size and can be resized; the dimension shows its calibrated length with extension lines (FR31)
**And** an uncalibrated page shows "Scale not set" on the dimension

### Story 5.9: Underline and strikethrough PDF text

As a drafter,
I want to underline or strike through text in the PDF,
So that I can mark text changes.

**Acceptance Criteria:**

**Given** a page with a text layer
**When** I use Select text, select words and choose Underline or Strikethrough
**Then** a text markup follows the selected glyph boxes (FR32)
**And** image-only pages disable the tools with a tooltip saying why

### Story 5.10: Properties panel and format painter

As a drafter,
I want to edit markup properties and copy formatting,
So that markups match company standards.

**Acceptance Criteria:**

**Given** a selection
**When** I open Properties (`Alt+P`)
**Then** I can edit colour, line width, fill, opacity, font, text, caption, subject and layer; multi-selection edits shared fields; changes apply immediately and are undoable (FR34, UX-DR22)
**And** format painter copies style from one markup to others
**And** numeric fields use NumberField with units

### Story 5.11: White-out and erase original content

As a drafter,
I want to cover original drawing content,
So that as-built changes replace what was drawn without destroying the original.

**Acceptance Criteria:**

**Given** an open drawing
**When** I choose White-out (`Shift+W`) and draw a rectangle or polygon, or use the eraser brush on original content
**Then** a white cover markup hides the content on screen while the original PDF stays intact (FR36, AR25)
**And** the cover can be selected, edited and deleted like any markup until flatten/export

### Story 5.12: Markup layers

As a drafter,
I want to organise markups into layers,
So that I can show, hide or lock groups of work.

**Acceptance Criteria:**

**Given** the Layers panel (`Alt+Y`)
**When** I create, rename, delete or reorder layers, set the active layer, assign markups, or toggle show/hide/lock
**Then** new markups go to the active layer and hidden layers are excluded from print/export unless chosen (FR67, UX-DR23)
**And** deleting a layer asks where its markups go (move to another layer or delete, with scope shown)

### Story 5.13: Personal signature stamp

As a drafter,
I want to store my signature and stamp it on drawings,
So that I can sign as-builts.

**Acceptance Criteria:**

**Given** Settings → Account & signature
**When** I draw a signature on the SignaturePad or upload an image (size-limited, re-encoded), preview and save
**Then** it is stored in the private `signatures` bucket at `<user_id>/…` with a `signatures` table row under RLS (owner only), served by signed URLs ≤10 min (FR83, AR19)
**And** I can place it as a signature stamp showing my name and the date, editable like other markups
**And** RLS tests prove other users cannot read my signature

## Epic 6: Auto-save, Markup Sets and Markups List

Markups save automatically (offline queue, status-bar save states), reopen with the identical PDF, warn about other versions, list markup sets, and appear in a sortable, filterable Markups List with author/time history.

### Story 6.1: Identify the file and create its markup set

As a drafter,
I want the app to recognise the exact PDF I opened,
So that my work is tied to that file and never to a different version.

**Acceptance Criteria:**

**Given** I am signed in and open a PDF
**When** `engine.worker` computes the SHA-256 of the bytes in parallel with rendering (A1, AR9)
**Then** a migration in this story creates `drawings`, `drawing_files` (sha256, pdf.js fingerprint, page_count, filename, parent_file_id, storage_path null), `pages` (stable `page_id`, index, rotation, crop box, size) and `calibrations` (per page_id) with RLS owner policies and RLS tests (AR5, AR6)
**And** the first edit (or calibration) on an unknown hash creates the drawing, file and page rows; merely opening a file creates nothing on the server
**And** calibrations from Epic 4 are saved per page id
**And** no PDF bytes are sent (NFR26 test still passes)

### Story 6.2: Save markups through the ops RPC

As a drafter,
I want every markup change saved to my account,
So that my work is safe without pressing Save.

**Acceptance Criteria:**

**Given** a drawing with a markup set
**When** I create, edit or delete markups
**Then** a migration creates `markups` (uuid v7 id, drawing_id, page_id, type, geometry/style/props jsonb, version, field_versions, author, created_at, updated_at, deleted_at) with RLS via `app.fn_effective_access(drawing_id)` (FR49, AR6)
**And** commands emit ops `{opId, markupId, kind, fields?, baseVersion, clientTs}` batched (~300 ms) to `apply_markup_ops(drawing_id, ops[])`, a SECURITY DEFINER RPC that re-checks access, applies field-level last-write-wins, lets tombstones win and returns versions (AR10, NFR22)
**And** author, creation time and modification time are recorded for every markup (FR55)
**And** inputs are validated with the shared Zod schemas and protected fields cannot be set (NFR24); op writes are rate-limited per user
**And** round-trip ≤500 ms p95 on the local stack benchmark (NFR4); the UI never waits on the server (NFR3)
**And** casing conversion happens only in `src/lib/db/markups.ts` (AR7); tests cover LWW, tombstones and IDOR attempts (NFR21)

### Story 6.3: Offline queue and save status

As a drafter,
I want to keep working when the network drops and always see whether my work is saved,
So that I never lose markups.

**Acceptance Criteria:**

**Given** edits in progress
**When** ops are produced
**Then** they are stored in an IndexedDB queue (`idb`) before sending and replayed in order on reconnect, with exponential backoff capped at 30 s and resume on `online`; `CONFLICT` re-bases and resends (NFR37, AR10)
**And** the SaveIndicator shows `✓ Saved`, `Saving…`, `⚠ Offline — n changes waiting`, `✕ Not synced — Retry` and `Local only — Sign in to save` (session expired; re-auth keeps the queue), with a details popover (UX-DR10)
**And** undo of an already-synced change is sent as a compensating op (A4)
**And** a Playwright test edits offline, reloads the page and confirms nothing is lost after reconnect
**And** `Ctrl+S` triggers an immediate sync instead of the browser save dialog

### Story 6.4: Restore markups when reopening the same PDF

As a drafter,
I want my markups back when I reopen the same file,
So that I can continue where I left off.

**Acceptance Criteria:**

**Given** a markup set exists for a file's SHA-256
**When** I open that identical file
**Then** markups and calibrations load from IndexedDB first, then reconcile with the server, and the status shows `✓ Saved` (FR50, UX-DR17)
**And** a file changed outside the app (different hash) opens as a new drawing with no markups moved
**And** loading never blocks rendering; markups appear after the first frame

### Story 6.5: Tell me markups exist on another version

As a drafter,
I want a hint when I open a newer copy of a file I marked up,
So that I can find my earlier work without it being moved.

**Acceptance Criteria:**

**Given** I have a markup set for "L17 RCP.pdf"
**When** I open a file with the same filename but a different hash
**Then** the HintBar shows "Markups exist on another version of this file · Open markup set list", dismissible, never wording that suggests loss (FR81, UX-DR11, UX-DR17)
**And** markups are not copied or moved

### Story 6.6: My markup sets

As a drafter,
I want a list of my markup sets,
So that I can reopen past work.

**Acceptance Criteria:**

**Given** I am signed in
**When** I open File → Markup sets or the EmptyWorkspace recent list
**Then** I see filename, page count and last modified for each set, newest first (FR51)
**And** opening one asks me to open the matching local PDF and restores markups when the hash matches; otherwise it shows markups on blank pages with filename and page count
**And** the list has an empty state

### Story 6.7: Markups List panel

As a drafter,
I want all markups in a table,
So that I can review my work in one place.

**Acceptance Criteria:**

**Given** a drawing with markups
**When** I open the Markups List (bottom panel or `Alt+L`)
**Then** a virtualised grid shows type icon, subject, page label, comments count, date, author, status, colour, layer and measurement value for thousands of rows smoothly (FR45, UX-DR28)
**And** multi-selection syncs with the canvas and Properties; double-click zooms to the markup
**And** the grid supports keyboard row/column navigation (UX-DR38)

### Story 6.8: Sort, filter and search the Markups List

As a drafter,
I want to sort, filter and search markups,
So that I can find the ones I need.

**Acceptance Criteria:**

**Given** the Markups List
**When** I sort a column, add column filters or type in the quick filter
**Then** rows update instantly, active filters show as removable chips and a count reads "Showing 24 of 312" (FR46, UX-DR28)
**And** selecting a row jumps to the markup on its page

## Epic 7: Tool Chest, Stamps and Legend

Users build personal tool sets, save configured markups as typed device tools, place them with counts, import Revu `.btx`, export/import their own format, and place revision stamps and an auto-updating legend. FR42 is split per step (A15).

### Story 7.1: Personal tool sets

As a drafter,
I want to create and organise my own tool sets,
So that my symbols are ready to place.

**Acceptance Criteria:**

**Given** the Tool Chest panel (`Alt+X`)
**When** I create, rename, reorder or delete tool sets
**Then** a migration creates `tool_sets` and `tools` with owner RLS and tests, and the panel shows sets as collapsible groups with instant search (FR39, UX-DR19)
**And** the empty state reads "No tool sets yet · Import .btx / Create set"
**And** deleting a set confirms with its tool count

### Story 7.2: Save a markup as a tool

As a drafter,
I want to save any configured markup or symbol as a tool, optionally as a device,
So that I can reuse it and count it.

**Acceptance Criteria:**

**Given** a selected markup
**When** I choose "Add to Tool Chest", pick a set and optionally type it as a device (group, label, description)
**Then** the tool stores the markup's geometry and style; images go to the private `tool-assets` bucket at `<owner_id>/<tool_set_id>/…` (FR40, AR19)
**And** the tile shows a preview and name

### Story 7.3: Place tools and count devices

As a drafter,
I want to place tools from the Tool Chest,
So that I can stamp symbols quickly and know how many I placed.

**Acceptance Criteria:**

**Given** a tool set
**When** I click a tile to arm it (or press `S` for the last stamp) and click the canvas, or drag a tile onto the canvas
**Then** the symbol is placed at real size on calibrated pages (tiles needing calibration are disabled with a reason) and the tool stays armed until `Esc` (FR41, UX-DR19)
**And** device-typed placements are counted per device type and the counts are available to the legend and Markups List
**And** the first use of the Tool Chest shows one dismissible inline tip (UX-DR16)

### Story 7.4: Import a `.btx` file safely

As a drafter,
I want to import my Revu tool set file,
So that I keep the tools I already use.

**Acceptance Criteria:**

**Given** Tool Chest → Import .btx
**When** I choose a `.btx` file
**Then** `engine.worker` parses it with file-size and decompressed-size limits, external entities disabled and sanitised appearance content (NFR31), using the parser proven in Story 2.1
**And** outcomes follow F7: all ok → set added with toast "Sprinkler Tools — 66 tools"; partial → set added plus a per-item report with reasons; invalid → "Not a Revu tool set file" and nothing changed (FR42, UX-DR19)
**And** a malformed or oversized file never freezes or crashes the app

### Story 7.5: Faithful `.btx` tool conversion

As a drafter,
I want imported tools to look and behave like they did in Revu,
So that my drawings stay consistent.

**Acceptance Criteria:**

**Given** the founder's 138 tool items in `fixtures/private/btx/`
**When** they are imported
**Then** each item converts to a native tool (stamp, device, markup type) that renders within the pixel-diff threshold of its Revu reference PNG and can be placed (A9)
**And** ≥95 % of items pass (NFR10); failures appear in the import report with reasons
**And** synthetic fixtures with unit tests are committed for each supported item kind
**And** (founder decisions 2026-10-20, `docs/spikes/2-1-btx-report.md`) imported ink drops Revu pressure and draws at a uniform, user-selectable stroke width; FreeText asking for Calibri renders with the bundled Carlito (SIL OFL); without Revu reference PNGs the fidelity check is the founder's review of contact sheets

### Story 7.6: Export and import tool sets in our format

As a drafter,
I want to back up and share tool sets as files,
So that I can move them between accounts.

**Acceptance Criteria:**

**Given** a tool set
**When** I export it
**Then** a versioned JSON file (with embedded assets) is saved locally (FR43)
**And** importing such a file validates it with Zod and size limits and adds a new set; invalid files change nothing

### Story 7.7: Revision stamp

As a drafter,
I want a revision stamp,
So that each as-built shows its revision, date, author and description.

**Acceptance Criteria:**

**Given** an open drawing
**When** I place a revision stamp
**Then** it shows revision number, description, author name and date, editable in Properties, and behaves like a markup (FR37, UX-DR27)

### Story 7.8: Auto legend

As a drafter,
I want a legend that lists the devices I placed with counts,
So that I do not count symbols by hand.

**Acceptance Criteria:**

**Given** device-typed placements on the page or document
**When** I insert a legend (page or document scope)
**Then** a legend box lists each device symbol with its label and count (FR38, UX-DR27)
**And** counts update live when devices are added, deleted or retyped
**And** the legend logic is refactored from the prototype (A12) with unit tests

## Epic 8: Flatten, Export and Print

Users flatten markups, export editable or flattened PDFs that open in Acrobat/Revu/Chrome, and print with options; export and print events are recorded. Completes the M1 gate.

### Story 8.1: Export a PDF with editable markups

As a drafter,
I want to export my drawing with markups as standard PDF annotations,
So that others can open and edit them in Acrobat or Revu.

**Acceptance Criteria:**

**Given** a drawing with markups
**When** I choose File → Export → Editable PDF (ExportDialog: page range, hidden layers excluded unless chosen)
**Then** `export.worker` writes the PDF with `@cantoo/pdf-lib` following `docs/export-mapping.md` (native / appearance-only / forced flatten per type) (FR60, AR25)
**And** the file opens without errors in Acrobat, Revu and Chrome, and native markups stay editable in Acrobat and Revu (NFR41 checklist recorded)
**And** measurement values in the export match the screen to the chosen precision (NFR8)
**And** a toast "Exported A1721 Rev C.pdf · Show in folder" confirms the save (UX-DR29)

### Story 8.2: Flatten markups and export a flattened PDF

As a drafter,
I want to burn markups into the drawing,
So that I can issue a final as-built that nobody can change by accident.

**Acceptance Criteria:**

**Given** a drawing with markups
**When** I choose Flatten (`Ctrl+Shift+M`) or File → Export → Flattened PDF
**Then** all visible markups (including white-out covers) are drawn onto the original pages and saved as a new local PDF; the original file is untouched (FR58, FR61, AR25)
**And** the flattened output visually matches the canvas
**And** the in-app markup set is unchanged (flatten output is a deliverable, A2)

### Story 8.3: Print

As a drafter,
I want to print drawings with or without markups,
So that I can produce paper copies at scale.

**Acceptance Criteria:**

**Given** an open drawing
**When** I press `Ctrl+P`
**Then** our print dialog offers page range, with/without markups, fit-to-page or actual scale, and paper size, replacing the browser default (FR68)
**And** printing uses a generated PDF so actual-scale output measures correctly on paper
**And** hidden layers are excluded unless chosen

### Story 8.4: Record export and print events

As the platform admin,
I want export and print events recorded without drawing content,
So that I can measure real use during the pilot.

**Acceptance Criteria:**

**Given** a user exports or prints
**When** the action completes
**Then** an `activity_events` row is written (`markup.exported`, `drawing.printed`) with time, user, markup set and page count, never content or filename of client drawings (FR80, AR21)
**And** the migration creates `activity_events` with RLS (insert own, select by platform admin) and tests

### Story 8.5: M1 release readiness

As the founder,
I want the M1 workspace deployed and verified end to end,
So that pilots can do as-built work for 5 days without Revu.

**Acceptance Criteria:**

**Given** Epics 1–8 are complete
**When** the release pipeline runs
**Then** the app deploys to Vercel (`syd1`) with Supabase cloud (ap-southeast-2), migrations applied by CI `supabase db push`, and Sentry receiving errors (AR22, NFR35, NFR46)
**And** Settings → Keyboard shortcuts lists the basic set (view-only) matching the UX spec table (UX-DR35)
**And** a keyboard-only Playwright test completes open → calibrate → measure → stamp → flatten/export, and axe-core finds no serious/critical violations on workspace chrome (UX-DR39)
**And** the viewport matrix 1280×720, 1440×900, 1920×1080 and 2560×1440@2x passes the smoke suite
**And** uptime monitoring with alerts is in place for the production app (NFR38)
**And** a security review pass is completed with no open High findings (NFR36)

## Epic 9: 4541 Sprinkler Layout Engine

Sprinkler designers define zones, assign uses → hazard classes, auto-place heads, tune preferences, view coverage, edit heads manually and read a per-zone rule report with the advisory notice. The placer and oracle stories (9.4–9.7) are implemented by a Fable-model agent from `docs/4541-placement-design.md`, starting from the Story 2.2 spike (AR24). FR73 is split per step (A15).

### Story 9.1: Seed rule figures and use → hazard mapping

As a sprinkler designer,
I want the verified NZS 4541 figures and default use mapping built in,
So that every layout is checked against the same numbers.

**Acceptance Criteria:**

**Given** the founder-verified ruleset `nzs4541` v1
**When** this story is complete
**Then** `src/core/sprinkler/rules` holds the versioned JSON (`verified: true`; ELH Amax 21 m², Smax 4.6 m, Wmax 2.3 m; OH1–3 Amax 12 m², Smax 4.0 m, Wmax 2.0 m; all Smin 1.8 m, Wmin 50 mm) with a schema that allows extra named tables with their own `verified` flag (A7, AR24 hooks)
**And** a migration creates `rule_figures` and `use_hazard_map(company_id nullable)` with RLS (read for signed-in users, write for platform admin only) and seeds v1 plus the draft mapping (Office/Meeting/Corridor → ELH, Kitchen/Plant → OH1, Storage/Retail/Carpark → OH2) (FR79 seeded)
**And** a test fails if the DB seed and the JSON disagree
**And** the founder's manual timing of head placement on the 3 baseline drawings is recorded in `docs/spikes/m2-baseline.md` before the engine is used on them (A16)

### Story 9.2: Create zones in the 4541 panel

As a sprinkler designer,
I want to fill rooms or draw polygons as zones,
So that the engine knows where to place heads.

**Acceptance Criteria:**

**Given** the 4541 panel (`Alt+4`)
**When** the page is uncalibrated
**Then** the panel shows only "Calibrate this page first" with a Calibrate button (UX-DR24)
**And** on a calibrated page the empty state shows the checklist Zones ▢ Uses ▢ Place heads ▢ with Fill zone (dynamic fill, `J`) and Polygon zone
**And** a new zone appears in the ZoneList with name, default use (company default, else Office → ELH), hazard chip and area, and the checklist ticks itself (FR70)
**And** holes inside a zone are tagged `column` or `shaft/void` (default from size, user-changeable)
**And** a migration creates `zones` (drawing_id, page_id, polygon in PDF points, holes with tags, use, options) with RLS via effective access, and zones sync through the same op path as markups
**And** zone selection syncs between the list and the canvas (muted violet outline)
**And** the first use of the 4541 panel shows one dismissible inline tip (UX-DR16)

### Story 9.3: Assign a use and hazard class

As a sprinkler designer,
I want to pick each zone's use and see its hazard and figures,
So that the right rules apply.

**Acceptance Criteria:**

**Given** a zone in the ZoneList
**When** I change its use from the dropdown
**Then** the hazard class and rule figures (Amax, Smax, Smin, Wmax, Wmin, ruleset version) update instantly and are shown so I can check them against the standard (FR71)
**And** the company mapping is used when present, else the platform default

### Story 9.4: Independent coverage oracle (Fable)

As a sprinkler designer,
I want every layout checked by an independent checker,
So that I can trust the report even if the placer has a bug.

**Acceptance Criteria:**

**Given** a zone, its barriers and a set of heads
**When** `src/core/sprinkler/oracle` runs
**Then** it samples its own ≤100 mm grid including boundary points and checks coverage, wall distance (Wmax on walls and zone edges, not on column faces), Wmin clearance on walls and columns, spray shadow behind columns/barriers, min/max spacing, and zones touching without a wall across the shared edge; area per head over Amax is a warning (design §4, founder decisions)
**And** it imports nothing from the placer; lint and a CI test enforce this (AR24)
**And** it takes one `Barrier[]` input for walls, holes and future obstructions (§9.5 hook)
**And** NFR9 named zones (rectangle, L-shape, triangle, diagonal wall, corridor) and the spike fixtures are in `fixtures/zones/` with tests, plus mutation tests (missing head, moved head, duplicate, head near wall, too few heads) that must all be caught

### Story 9.5: Placement for single-bay zones (Fable)

As a sprinkler designer,
I want heads placed automatically in simple rooms,
So that a rectangular or convex room is done in one click.

**Acceptance Criteria:**

**Given** a rectangular or convex zone with a hazard class
**When** `src/core/sprinkler/placer` runs in `engine.worker`
**Then** it searches grid frames (≤3 angles plus 90° turns) and places rows with the exact 1-D optimisation per row; all rules are hard constraints with no repair pass (design §3, FR73)
**And** the objective is head count first, then deviation from preferred spacing / wall distance, then alignment (A8)
**And** the oracle reports zero errors on every feasible fixture and output is identical across runs
**And** an infeasible zone returns a typed error with location and reason (e.g. `NO_ADMISSIBLE_REGION`)

### Story 9.6: Placement for irregular zones with holes (Fable)

As a sprinkler designer,
I want L, U, T, splayed and column-filled rooms handled,
So that real floor plans work, not just rectangles.

**Acceptance Criteria:**

**Given** a non-convex zone, zones with columns or shafts, or zones sharing an open edge
**When** the placer runs
**Then** it decomposes bays at reflex corners, treats columns per the founder rule (spray shadow + Wmin, no Wmax) and shafts as walls, keeps spacing across bay seams and shared zone edges, and adds gap-fill heads only where needed (design §3)
**And** the oracle reports zero errors on all feasible fixtures including the founder's L17/L21-derived zones and 54+ seeded random/rotated zones
**And** a single zone ≤200 m² places in ≤1 s and a 600 m² floor of ≤15 zones in ≤5 s on reference hardware, with no main-thread task >50 ms (NFR6)
**And** the large multi-column floor case (spike R1) is improved over the spike result or documented as a known limitation

### Story 9.7: Pattern, ceiling grid and preferences (Fable)

As a sprinkler designer,
I want to choose staggered layouts, align to ceiling tiles and set preferred spacing,
So that layouts match how I would draw them.

**Acceptance Criteria:**

**Given** a zone's options
**When** I set pattern (rectangular default / staggered), declare a ceiling grid (tile size and origin; tile-centre stops, mode `preferred` default or `required`), or set preferred spacing and wall distance within the rule limits (FR74)
**Then** the placer honours them within the hard constraints and reports when a preference could not be met
**And** heads marked as manually edited are fixed inputs for the placer (used by re-run)

### Story 9.8: Place heads from the panel

As a sprinkler designer,
I want to click Place heads and watch zones fill,
So that I get a full layout in seconds without freezing the app.

**Acceptance Criteria:**

**Given** zones on a calibrated page
**When** I click Place heads (selected zones, or all when none selected)
**Then** `engine.worker` places zone by zone with a progress tick per zone; heads appear zone by zone and the canvas stays usable (FR73, UX-DR24)
**And** heads are device markups (counted in the legend and Markups List) created through commands; the whole run is one undo step (UX-DR35)
**And** a migration creates `zone_layouts` (rule_figure_version, inputs, result, report) and each run stores the ruleset version used (A7)
**And** an infeasible zone shows an error card with location, reason and suggestion; other zones still complete
**And** a `sprinkler.placed` activity event is recorded without drawing content

### Story 9.9: Coverage overlay

As a sprinkler designer,
I want to see the coverage around each head,
So that any gap is obvious.

**Acceptance Criteria:**

**Given** placed heads
**When** placement finishes or I toggle the overlay
**Then** each head shows a translucent per-head polygon (circle default, square toggle), uncovered areas are hatched, and toggling takes ≤100 ms (FR75, NFR7, UX-DR25)
**And** coverage polygons are clipped by spray shadows from columns and barriers (rendered from polygons so post-MVP obstructions drop in)
**And** the staged fade-in is instant under `prefers-reduced-motion`

### Story 9.10: Adjust heads by hand

As a sprinkler designer,
I want to move, add or delete heads and see the check update live,
So that I can work around lights and services.

**Acceptance Criteria:**

**Given** a placed layout
**When** I drag, add or delete heads
**Then** the oracle re-checks live and the report and markers update while dragging (FR76)
**And** edited heads are marked manual; re-running placement on the zone confirms the scope ("Re-place 2 zones, keep 3 edited heads") and keeps them fixed (UX-DR24, founder decision)

### Story 9.11: Zone report and rule-break markers

As a sprinkler designer,
I want a per-zone report and markers where rules break,
So that I can fix problems quickly and explain the layout.

**Acceptance Criteria:**

**Given** a zone with heads
**When** the oracle result is available
**Then** the ZoneReport shows hazard, ruleset version, head count, area per head, max spacing, min/max wall distance and the list of rule breaks, without blocking any action (FR77, UX-DR24)
**And** rule breaks are pinned on the canvas as danger ✕ markers with short labels ("Spacing 4.8 m > 4.6 m"); area warnings as ⚠; clicking a marker or row zooms and selects the other (UX-DR26)
**And** zone status in the ZoneList shows ✓ / ⚠ n / ✕ n / infeasible with icons and text, and changes are announced in the polite live region

### Story 9.12: Advisory notice

As a sprinkler designer,
I want it clear that layouts are advisory,
So that responsibility for compliance is never misunderstood.

**Acceptance Criteria:**

**Given** the 4541 panel
**When** it is open
**Then** its footer states that layouts are advisory and the designer remains responsible for compliance (FR78)
**And** the Export and Flatten dialogs offer "Include advisory notice", which adds the notice to exported pages

### Story 9.13: M2 release readiness

As the founder,
I want the 4541 engine verified end to end,
So that pilots can use it on real projects.

**Acceptance Criteria:**

**Given** Epic 9 is complete
**When** the M2 checks run
**Then** a keyboard-only Playwright test completes zone → use → Place heads → read report (UX-DR39)
**And** NFR6 timings are measured on reference hardware and recorded
**And** the founder compares engine results with the A16 manual baseline on the 3 drawings and records time saved and any rule disagreements
**And** a security review pass is completed with no open High findings (NFR36)

## Epic 10: Accounts, Companies and Platform Administration

Visitors sign up (pending activation), users manage profile and reset passwords, company admins invite and manage members, publish company tool sets and edit use → hazard mapping; the platform admin creates companies, activates users, sets plans, views activity and edits rule figures.

### Story 10.1: Sign up and wait for activation

As a visitor,
I want to create an account,
So that I can request access to Plan Markup.

**Acceptance Criteria:**

**Given** `/sign-up`
**When** I submit email and password (≥12 characters, show/hide, leaked-password check, no maximum below 64) with Cloudflare Turnstile
**Then** I must verify my email before anything else, and my profile is `pending` (FR1, NFR14, NFR18, AR18)
**And** a transactional email provider is configured for Supabase Auth SMTP (local dev uses the Supabase mail catcher)
**And** responses never reveal whether the email already exists; sign-up is rate-limited (NFR15, NFR16)
**And** signing in while pending shows PendingActivation "Your account is waiting for approval" with what happens next, and no workspace access (UX-DR30, F6)

### Story 10.2: Reset my password

As a user,
I want to reset a forgotten password by email,
So that I can get back in.

**Acceptance Criteria:**

**Given** "Forgot password"
**When** I request a reset (Turnstile, rate-limited)
**Then** a single-use link bound to my email and valid ≤1 h lets me set a new password; the response is the same whether or not the email exists (FR2, NFR16, NFR18)
**And** changing the password revokes all my other sessions (NFR17)
**And** redirects after reset use the allowlist (NFR19)

### Story 10.3: View and edit my profile

As a user,
I want to see and edit my name and email,
So that my markups show the right author.

**Acceptance Criteria:**

**Given** Settings → Account
**When** I change my name or email
**Then** the name updates immediately; an email change requires verification of the new address (FR4)
**And** protected fields (status, role, company, plan, admin flag) cannot be changed through any endpoint (NFR24)

### Story 10.4: Platform admin manages user accounts

As the platform admin,
I want to view, activate and deactivate accounts,
So that I control who uses the product during the pilot.

**Acceptance Criteria:**

**Given** the `(admin)` route group (Daylight theme, platform-admin claim checked server-side)
**When** I list users and activate or deactivate one
**Then** status changes take effect immediately: deactivation calls admin sign-out and `getAuthUser()` blocks the user on the next request (FR12, NFR17, AR4)
**And** an activated user receives a "You're in" email
**And** a migration creates `audit_log` and every admin write records actor, target, action and time (NFR34)
**And** admin screens meet WCAG 2.1 AA and work down to 768 px (NFR43, UX-DR37)

### Story 10.5: Create companies and their first admin

As the platform admin,
I want to create a company and assign its first admin,
So that a pilot company can manage its own people.

**Acceptance Criteria:**

**Given** the admin Companies screen
**When** I create a company and assign an existing user as its admin
**Then** a migration creates `companies` and `company_members(role in admin|member|viewer)` with RLS helpers `app.fn_is_company_member()` and tests (FR11, AR5)
**And** a user can belong to at most one company, enforced by a unique constraint (FR9)
**And** the action is audit-logged

### Story 10.6: Company admin invites users

As a company admin,
I want to invite people by email,
So that my team can join our company.

**Acceptance Criteria:**

**Given** the Company → Members screen
**When** I invite an email with a role
**Then** the invitee gets a single-use link bound to that email, valid ≤7 days; signing up or in through it makes them active members immediately (FR6, NFR18, F6)
**And** inviting someone already in another company shows a clear error
**And** invites are rate-limited and audit-logged

### Story 10.7: Change roles and remove members

As a company admin,
I want to change roles and remove people,
So that access matches each person's job.

**Acceptance Criteria:**

**Given** company members
**When** I change a role (admin, member, viewer) or remove a member
**Then** the change applies immediately and revokes the user's sessions (FR7, FR8, NFR17)
**And** removed users keep their own markup sets and fall back to individual use (FR8)
**And** the last company admin cannot be removed or demoted
**And** changes are audit-logged

### Story 10.8: Set plans

As the platform admin,
I want to set a plan on companies and individual users,
So that pilot and trial status is recorded before billing exists.

**Acceptance Criteria:**

**Given** a company or user in admin
**When** I set the plan field (trial, pilot, standard)
**Then** it is saved server-side only, audit-logged and never settable by users (FR13, NFR24)

### Story 10.9: Activity dashboards

As the platform admin or a company admin,
I want to see activity,
So that I know who is really using the product.

**Acceptance Criteria:**

**Given** `activity_events`
**When** I open Activity
**Then** the platform admin sees per company and user: last active, markups saved (counted from `markups.created_at` by author, no extra event) and PDFs exported per week (FR14)
**And** a company admin sees the same for their own company only (FR16)
**And** no drawing content or client filenames are shown

### Story 10.10: Support lookup

As the platform admin,
I want to look up a user's markup sets,
So that I can help with support questions.

**Acceptance Criteria:**

**Given** a user in admin
**When** I open Support lookup
**Then** I see their markup sets by filename and page count only, with no access to drawing content that was not uploaded (FR15)
**And** each lookup is audit-logged

### Story 10.11: Company tool sets

As a company admin,
I want to publish tool sets to my company,
So that everyone uses the same symbols.

**Acceptance Criteria:**

**Given** one of my tool sets
**When** I publish it to the company
**Then** all company users see it in the Tool Chest as a company set they can use but not edit (FR44)
**And** RLS tests prove members cannot edit and non-members cannot read it

### Story 10.12: Company use → hazard mapping

As a company admin,
I want to edit our default use → hazard mapping,
So that zones default to how we classify spaces.

**Acceptance Criteria:**

**Given** Company → 4541 settings
**When** I edit the mapping
**Then** new zones in my company use it; existing zones keep their use and hazard (FR72)
**And** edits are audit-logged

### Story 10.13: Edit rule figures

As the platform admin,
I want to maintain the default rule figures and mapping,
So that corrections to the standard reach everyone safely.

**Acceptance Criteria:**

**Given** admin → Rule figures
**When** I edit a figure
**Then** a new ruleset version is created (old versions stay for existing layouts), marked verified only when I confirm, and audit-logged (FR79 admin editing, A7)
**And** layouts show which version they were placed with

### Story 10.14: M3 release readiness

As the founder,
I want the SaaS foundation ready before the first pilot company,
So that their data is safe and support is possible.

**Acceptance Criteria:**

**Given** Epic 10 is complete
**When** the M3 gate is checked
**Then** Supabase Pro with 7-day point-in-time recovery is enabled (NFR39, AR22)
**And** production email delivery (verification, reset, invite, activation) is verified end to end
**And** the RLS matrix covers every role × table and passes in CI
**And** a security review pass is completed with no open High findings (NFR36)

## Epic 11: Sharing and Review

Users share markup sets by email, optionally store the PDF on the server, viewers set status and comment, Markups List and device counts export to CSV, status history is recorded, and open shared drawings update in real time.

### Story 11.1: Share a markup set by email

As a drafter,
I want to share my markup set with edit or view access,
So that reviewers and colleagues can work with me.

**Acceptance Criteria:**

**Given** ShareDialog from a drawing
**When** I enter an email and choose Edit or View
**Then** a migration creates `shares(drawing_id, grantee, access)`; effective access = min(company role, share grant) via `app.fn_effective_access` (FR52, A6, UX-DR29)
**And** the recipient gets an invite email; recipients without an account who sign up through it are activated automatically but can open only what was shared until fully activated (FR1, UX-DR40)
**And** I can see existing shares and revoke them; revocation takes effect immediately and is audit-logged (NFR34)
**And** RLS tests cover share access and IDOR attempts

### Story 11.2: Viewer mode

As a reviewer with view access or the viewer role,
I want to see markups without editing tools,
So that I cannot change the drawing by accident.

**Acceptance Criteria:**

**Given** view-only access
**When** I open the shared drawing
**Then** drawing tools are hidden, markups cannot be created or edited (enforced server-side), and I can still change status and add comments (FR10)

### Story 11.3: Markup status and comments

As a reviewer,
I want to set markup status and add comments,
So that the drafter knows what to fix.

**Acceptance Criteria:**

**Given** a markup in the Markups List or on canvas
**When** I set its status or add a comment
**Then** a migration creates `markup_events` (append-only) and status changes and comments are recorded with author and time (FR47, FR55 status changes, A4)
**And** the Markups List status cell is editable for reviewers and the comments count updates
**And** text renders as plain text (NFR27)

### Story 11.4: Server PDF storage on/off

As a drafter,
I want to choose whether my PDF is stored on the server,
So that recipients can see the drawing only when I allow it.

**Acceptance Criteria:**

**Given** ShareDialog or drawing settings
**When** I turn server storage on
**Then** the PDF uploads to the private `drawings` bucket at `<company_or_user>/<drawing_id>/<sha256>.pdf` and is served only via signed URLs ≤10 min after an authorization check (FR53, NFR25, AR19)
**And** turning it off deletes the stored file immediately (NFR26)
**And** with storage off, the Playwright no-upload test still passes

### Story 11.5: Recipient view with or without the server PDF

As a share recipient,
I want to see markups even when the PDF is not stored,
So that I can review using my own copy.

**Acceptance Criteria:**

**Given** a shared drawing
**When** server storage is on
**Then** I see the PDF with markups (FR54)
**And** when it is off I see markups on blank pages with "Open L3 RCP Rev C (4 pages) to view the drawing"; opening my local copy with the same hash shows the full view (FR54, UX-DR40)
**And** a shared link opened on a phone shows "Open on a desktop to view and edit" with drawing name and sharer (UX-DR30)

### Story 11.6: Live updates on shared drawings

As a collaborator,
I want changes from others to appear while I have the drawing open,
So that we do not work on stale markups.

**Acceptance Criteria:**

**Given** a shared drawing open by two users
**When** one edits
**Then** the other receives the change within 2 s (p95) through Supabase Realtime channel `drawing:<id>` and applies it through the same op path; single-user drawings do not subscribe (AR11)
**And** conflicts resolve by field-level LWW with a toast "Updated from another device" (UX-DR10)

### Story 11.7: Export Markups List and device counts to CSV

As a drafter,
I want CSV exports,
So that I can report quantities and review status in a spreadsheet.

**Acceptance Criteria:**

**Given** the Markups List (with current filters)
**When** I export CSV
**Then** a CSV of the visible columns and a device-count CSV are saved locally (FR48)
**And** values that start with `=`, `+`, `-` or `@` are escaped to prevent spreadsheet formula injection

## Epic 12: Page Editing and Document Compare

Users edit pages with markups following their pages, merge PDFs, flatten selectively with unflatten, and compare two revisions. FR56 is split per operation (A15).

### Story 12.1: Insert, delete, extract and replace pages

As a drafter,
I want to insert, delete, extract and replace pages,
So that I can assemble the right drawing set.

**Acceptance Criteria:**

**Given** the Thumbnails context menu or Document menu
**When** I insert pages from another PDF or a blank page, delete, extract or replace pages
**Then** the edit creates a new file version linked by `parent_file_id`, and markups and calibrations stay attached to their stable page ids (FR56, A2, AR9)
**And** deleted pages' markups are tombstoned with undo available; extract saves a new local PDF without markups
**And** browser-reserved keys are not bound; commands live in menus

### Story 12.2: Rotate, reorder and crop pages

As a drafter,
I want to rotate, reorder and crop pages,
So that sheets are oriented and trimmed correctly.

**Acceptance Criteria:**

**Given** pages in Thumbnails
**When** I rotate, drag to reorder, or crop pages
**Then** markups and calibrations are transformed with their pages (FR56, A2)
**And** each edit is undoable and creates a new file version

### Story 12.3: Merge PDFs

As a drafter,
I want to merge several PDFs into one,
So that I can issue a single set.

**Acceptance Criteria:**

**Given** several local PDFs
**When** I merge them in a chosen order
**Then** a new PDF is produced locally; markup sets of merged files follow their pages when merged in-app (FR57)

### Story 12.4: Selective flatten and unflatten

As a drafter,
I want to flatten only some markups and undo flatten later,
So that I can issue partial as-builts and keep working.

**Acceptance Criteria:**

**Given** FlattenDialog
**When** I choose all, filtered or selected markups, by type and page range, and "allow unflatten"
**Then** only those markups are flattened and markup data is embedded so our app can restore them (FR59, AR25)
**And** reopening the flattened file in our app offers Unflatten (`Ctrl+Shift+U`)

### Story 12.5: Spike — compare algorithm

As the founder,
I want the compare approach proven before building the UI,
So that FR84 is reliable on vector drawings.

**Acceptance Criteria:**

**Given** two revisions of the founder's sample sheets
**When** a prototype runs vector diff by page with raster fallback in a worker
**Then** added, removed and changed content is detected on named fixture pairs (founder's L17/L21 revisions plus synthetic edits) with measured accuracy and runtime on reference hardware (AR30)
**And** the report recommends the approach for Story 12.6

### Story 12.6: Compare two documents

As a drafter,
I want to compare two revisions page by page,
So that I can see what changed.

**Acceptance Criteria:**

**Given** two open PDFs
**When** I start Compare
**Then** CompareView shows them side by side or overlaid with added, removed and changed content in distinct colours and a legend; colour is paired with pattern or label (FR84, UX-DR29)
**And** the comparison runs off the main thread

### Story 12.7: Cloud the differences

As a drafter,
I want to turn compare results into clouds,
So that changes are marked on my drawing.

**Acceptance Criteria:**

**Given** a comparison result
**When** I choose "Cloud differences"
**Then** cloud markups are created around each difference on the target document as one undo step (FR84)

## Epic 13: Public Site and Help Centre

Visitors browse the marketing site and help centre, request access, and read privacy/terms; pages are crawlable by search engines and AI assistants.

### Story 13.1: Marketing site

As a visitor,
I want to learn what Plan Markup does,
So that I can decide whether to try it.

**Acceptance Criteria:**

**Given** the `(marketing)` route group (static, Daylight, hash-based CSP)
**When** I browse features, use cases, pricing, security & privacy and FAQ
**Then** pages are fully responsive from 360 px, ship no canvas code, and meet Core Web Vitals (LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms) (FR62, NFR44, UX-DR37)
**And** pages meet WCAG 2.1 AA with landmarks, heading order, alt text and a skip link (NFR43)

### Story 13.2: Help centre

As a user,
I want how-to guides,
So that I can learn features without asking.

**Acceptance Criteria:**

**Given** `/help`
**When** I browse or search guides (calibrate, measure, Tool Chest and `.btx` import, flatten/export, 4541, sharing, keyboard shortcuts)
**Then** each guide is a static page with screenshots and steps (FR63)

### Story 13.3: Discoverability for search engines and AI assistants

As the founder,
I want marketing and help pages easy to find,
So that contractors discover the product.

**Acceptance Criteria:**

**Given** the public pages
**When** crawlers visit
**Then** structured data validates in Google's Rich Results Test, a sitemap and `robots.txt` exist, `llms.txt` summarises the product, and app routes are excluded from crawling (FR64, NFR44)

### Story 13.4: Request access from the site

As a visitor,
I want to sign up or request access from the marketing site,
So that I can start a trial.

**Acceptance Criteria:**

**Given** a marketing page
**When** I click the call to action
**Then** I reach sign-up (Story 10.1) and see that new accounts are activated by the team (FR65)

### Story 13.5: Privacy policy and terms

As a visitor or user,
I want to read the privacy policy and terms,
So that I know how my data and drawings are handled.

**Acceptance Criteria:**

**Given** the site footer or the app Help menu
**When** I open Privacy or Terms
**Then** the pages explain that drawings stay on my computer unless I enable server storage, data is hosted in Australia/NZ, and how deletion works (FR66, NFR26, NFR35)

### Story 13.6: M4 launch readiness

As the founder,
I want the full MVP verified before launch,
So that the public launch is safe.

**Acceptance Criteria:**

**Given** Epics 1–13 are complete
**When** the launch gate is checked
**Then** axe-core passes on all public and admin routes, NVDA spot checks are recorded, and the browser matrix (Chrome/Edge full, Firefox/Safari smoke) passes (NFR42, UX-DR39)
**And** service availability over the pilot period is reported against the ≥99.5 % target (NFR38)
**And** 3 new pilot users each complete open → calibrate → place symbols → cloud → export flattened PDF without written instructions (PRD success criterion)
**And** a scale check confirms the design supports 50 companies / 500 users / 1M markups with per-page queries within NFR4 (NFR40)
**And** a security review pass is completed with no open High findings (NFR36)
