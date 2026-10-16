---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
documentsIncluded:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/epics.md
supportingDocuments:
  - docs/4541-placement-design.md
  - _bmad-output/planning-artifacts/ux-design-directions.html
  - spikes/4541-placement/README.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-10-17
**Project:** plan-markup

## Document Inventory

| Type | File | Size | Modified |
|---|---|---|---|
| PRD | `prd.md` (whole) | 61 KB | 2026-10-17 02:56 |
| Architecture | `architecture.md` (whole) | 44 KB | 2026-10-17 04:08 |
| UX Design | `ux-design-specification.md` (whole) | 63 KB | 2026-10-17 03:26 |
| Epics & Stories | `epics.md` (whole) | 128 KB | 2026-10-17 05:08 |

Supporting: `docs/4541-placement-design.md`, `ux-design-directions.html` (static mockup), `spikes/4541-placement/README.md` (placement spike results).

No sharded versions and no duplicates found. No required document missing.

## PRD Analysis

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

Total FRs: 84 (FR1–FR84; FR67–FR69 and FR80–FR84 were added in later PRD edits and sit out of numeric order in the PRD text)

### Non-Functional Requirements

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

Total NFRs: 47

### Additional Requirements

- **Architecture Inputs A1–A16** (binding defaults unless the architecture records better): SHA-256 file identity, page-id lineage, read-only existing annotations, field-level LWW + tombstones + append-only status log, export mapping table, min(role, grant), versioned rule figures, independent 4541 oracle, `.btx` fidelity criterion, performance definitions, vector fill output, prototype refactor (not copy), spike order, UX-first items, story splitting, M2 baseline timing.
- **Success criteria with gates:** M1 = founder 5/5 days without Revu; M2 = engine faster than manual on 3/3 drawings with full coverage; launch = M4; 3 weekly companies at +3 months, 15 at +12 months ("weekly use" = ≥1 export or ≥20 saved markups per company per week).
- **Usability criterion:** 3 new pilot users complete open → calibrate → place symbols → cloud → export flattened PDF without written instructions.
- **Constraints:** drawings stay local by default; all server data in AU/NZ; English-only product; clean-room (no Revu code); billing deferred; layouts advisory (designer responsible).
- **Out of MVP:** obstruction avoidance (obstruction library = Growth), general ceiling-tile snapping, hazard classes beyond ELH/OH1–OH3, PKI signatures, tablet mode, customisable shortcuts, billing, MFA.

### PRD Completeness Assessment

The PRD is complete and specific: 84 numbered, testable FRs tagged by milestone, 47 measurable NFRs (performance, accuracy, security, reliability, compatibility, accessibility), six journeys that trace to capability areas, explicit scope boundaries and a decision log. Later founder decisions (themes FR69, 4541 v1 figures, column rule, obstruction library as Growth, basic shortcuts in MVP) are reflected in the PRD or its linked design document.

Observations to carry into coverage validation:
1. NFR17 session lifetimes (idle 7 days, absolute 30 days, refresh-token rotation) need an explicit story criterion.
2. The "no training needed" success criterion (3 new users) and the "weekly use" metric (≥20 saved markups per company per week) need a home in stories (usability test; activity metric source).
3. FR numbering is out of order in places (FR67–69 and FR80–84 inserted later); harmless but worth a note for traceability tools.
4. The column rule decided on 2026-10-17 lives in `docs/4541-placement-design.md` and architecture, not in the PRD text; acceptable because A8 delegates rules to the design document.


## Epic Coverage Validation

### Coverage Matrix

| FR | PRD requirement (short) | Stories | Status |
|---|---|---|---|
| FR1 | Visitors can sign up with email and password; new accounts stay pendi… | 10.1, 11.1 | ✓ |
| FR2 | Users can sign in, sign out and reset their password by email. (M1/M3) | 10.2 | ✓ |
| FR3 | Users can use every workspace capability without belonging to a compa… | 1.7 | ✓ |
| FR4 | Users can view and edit their own profile (name, email). (M3) | 10.3 | ✓ |
| FR5 | The system blocks all app and data access for unauthenticated or pend… | 1.4 | ✓ |
| FR6 | Company admins can invite users to their company by email. (M3) | 10.6 | ✓ |
| FR7 | Company admins can assign and change the role of company users (admin… | 10.7 | ✓ |
| FR8 | Company admins can remove users from the company; removed users keep … | 10.7 | ✓ |
| FR9 | A user can belong to at most one company. (M3) | 10.5 | ✓ |
| FR10 | Viewers can view shared markup sets and change status / add comments,… | 11.2 | ✓ |
| FR11 | The platform admin can create companies and assign a company's first … | 10.5 | ✓ |
| FR12 | The platform admin can activate, deactivate and view any user account… | 10.4 | ✓ |
| FR13 | The platform admin can set the plan field (trial, pilot, standard) on… | 10.8 | ✓ |
| FR14 | The platform admin can view activity per company and user (last activ… | 10.9 | ✓ |
| FR15 | The platform admin can look up a user's markup sets by filename and p… | 10.10 | ✓ |
| FR16 | Company admins can view activity for their own company. (M3) | 10.9 | ✓ |
| FR17 | Users can open a PDF from their computer; the file is not uploaded un… | 3.1 | ✓ |
| FR18 | Users can open multiple PDFs in tabs and switch between them. (M1) | 3.5 | ✓ |
| FR19 | Users can navigate pages (next, previous, first, last, go to page) an… | 3.3 | ✓ |
| FR20 | Users can zoom, pan, fit page, fit width and rotate the view. (M1) | 3.2 | ✓ |
| FR21 | Users can search text in the PDF and jump to results. (M1) | 3.6 | ✓ |
| FR22 | Users can see page size, current scale and snap state in a status bar… | 3.7 | ✓ |
| FR23 | The system detects scale ratios printed on the drawing (including she… | 4.2 | ✓ |
| FR24 | Users can calibrate a page by two known points or by ratio, for the c… | 4.3 | ✓ |
| FR25 | Users can verify a calibration against a known dimension. (M1) | 4.4 | ✓ |
| FR26 | Users can measure length, polylength, area, count, angle, radius and … | 4.5, 4.7, 4.8 | ✓ |
| FR27 | The system shows "Scale not set" instead of a value when measuring an… | 4.6 | ✓ |
| FR28 | Users can create an area by dynamic fill (live spreading fill bounded… | 4.9 | ✓ |
| FR29 | Users can snap points to drawing line endpoints, midpoints, intersect… | 4.1 | ✓ |
| FR30 | Users can view totals of measurements in a Measurements panel. (M1) | 4.10 | ✓ |
| FR31 | Users can draw pen, highlight, typewriter (text typed directly on the… | 4.10, 5.4, 5.5, 5.6, 5.7, 5.8 | ✓ |
| FR32 | Users can apply underline and strikethrough to PDF text. (M1) | 5.9 | ✓ |
| FR33 | Users can select (click, lasso), move, resize, rotate, copy/paste, de… | 4.10, 5.1, 5.2, 5.3 | ✓ |
| FR34 | Users can edit markup properties (colour, line width, fill, opacity, … | 5.10 | ✓ |
| FR35 | Users can undo and redo markup actions. (M1) | 4.5, 5.1 | ✓ |
| FR36 | Users can erase or white-out original drawing content non-destructive… | 5.11 | ✓ |
| FR37 | Users can place a revision stamp showing revision number, date, autho… | 7.7 | ✓ |
| FR38 | Users can insert an auto-generated legend listing the device symbols … | 7.8 | ✓ |
| FR39 | Users can create, rename, reorder and delete personal tool sets. (M1) | 7.1 | ✓ |
| FR40 | Users can save any configured markup or symbol as a reusable tool, op… | 7.2 | ✓ |
| FR41 | Users can place tools from the Tool Chest onto the drawing; device-ty… | 7.3 | ✓ |
| FR42 | Users can import a Revu `.btx` tool set file into a personal tool set… | 2.1, 6.8, 7.4 | ✓ |
| FR43 | Users can export and import tool sets in the product's own file forma… | 7.6 | ✓ |
| FR44 | Company admins can publish company tool sets available to all company… | 10.11 | ✓ |
| FR45 | Users can see all markups in a list with subject, page label, comment… | 6.7 | ✓ |
| FR46 | Users can sort, filter and search the Markups List, and select a row … | 6.8 | ✓ |
| FR47 | Users can set markup status and add comments to markups. (M4) | 11.3 | ✓ |
| FR48 | Users can export the Markups List and device counts to CSV. (M4) | 11.7 | ✓ |
| FR49 | The system saves markups to the user's account automatically, linked … | 6.2 | ✓ |
| FR50 | When a user reopens the identical PDF, the system restores its markup… | 6.4 | ✓ |
| FR51 | Users can see a list of their markup sets (filename, pages, last modi… | 6.6 | ✓ |
| FR52 | Users can share a markup set with other registered users by email, gr… | 11.1 | ✓ |
| FR53 | Users can turn on server PDF storage for a drawing, and remove the st… | 11.4 | ✓ |
| FR54 | Share recipients see the PDF with markups when server storage is on; … | 11.5 | ✓ |
| FR55 | The system records author, creation time, modification time and statu… | 6.2, 11.3 | ✓ |
| FR56 | Users can insert pages from another PDF, insert blank pages, delete, … | 11.7, 12.1, 12.2 | ✓ |
| FR57 | Users can merge multiple PDFs into one. (M4) | 12.3 | ✓ |
| FR58 | Users can flatten all markups into the PDF content. (M1) | 8.2 | ✓ |
| FR59 | Users can flatten only filtered or selected markups, by markup type a… | 12.4 | ✓ |
| FR60 | Users can export a PDF with non-flattened markups as standard PDF ann… | 2.4, 8.1 | ✓ |
| FR61 | Users can export a flattened PDF. (M1) | 8.2 | ✓ |
| FR62 | Visitors can browse a public marketing site (features, use cases, pri… | 13.1 | ✓ |
| FR63 | Visitors can read a public help centre with how-to guides. (M4) | 13.2 | ✓ |
| FR64 | Search engines and AI assistants can crawl marketing and help pages, … | 13.3 | ✓ |
| FR65 | Visitors can request access / sign up from the marketing site. (M4) | 13.4 | ✓ |
| FR66 | Users can open the privacy policy and terms from the app and site. (M… | 13.5 | ✓ |
| FR67 | Users can create, rename and delete markup layers, assign markups to … | 5.12 | ✓ |
| FR68 | Users can print the drawing with or without markups, choosing page ra… | 8.3 | ✓ |
| FR69 | The workspace uses the dark Blueprint theme by default; users can swi… | 3.8 | ✓ |
| FR70 | Users can define zones on a calibrated page by dynamic fill or by dra… | 9.2 | ✓ |
| FR71 | Users can assign an occupancy/use (e.g. office, kitchen, storage) to … | 9.3 | ✓ |
| FR72 | Company admins can edit the default use → hazard class mapping for th… | 10.12 | ✓ |
| FR73 | Users can run automatic head placement for one zone or all zones; the… | 8.5, 9.5, 9.8 | ✓ |
| FR74 | Users can set preferred wall distance and preferred head spacing with… | 9.7 | ✓ |
| FR75 | Users can toggle a coverage overlay that draws a translucent shape ar… | 9.9 | ✓ |
| FR76 | Users can move, add or delete placed heads manually (e.g. to clear ob… | 9.10 | ✓ |
| FR77 | The system shows, per zone, hazard class, head count, area per head a… | 9.11 | ✓ |
| FR78 | The system displays that layouts are advisory and the designer remain… | 9.12 | ✓ |
| FR79 | The platform admin can maintain the default rule figures for ELH, OH1… | 9.1, 10.13 | ✓ |
| FR80 | The system records export and print events (time, user, markup set, p… | 8.4 | ✓ |
| FR81 | When a user opens a PDF whose filename matches one of their markup se… | 6.5 | ✓ |
| FR82 | When a user starts zone or measurement tools on an uncalibrated page,… | 4.6 | ✓ |
| FR83 | Users can create a personal signature (drawn on screen or uploaded im… | 5.13 | ✓ |
| FR84 | Users can compare two PDFs (e.g. two revisions of a sheet), page by p… | 12.5, 12.6, 12.7 | ✓ |

FRs referenced in epics but not in the PRD: none

### Missing Requirements

No FR is missing. During this check FR17, FR20 and FR35 were found untagged (their content was already in Stories 3.1, 3.2, 4.5 and 5.1, but no story cited the FR number; the earlier epics self-check had also scanned the epic list). The tags were added to those stories on 2026-10-17. Architecture requirements AR1–3, AR16–17, AR23, AR26, AR28–29 are implemented in Stories 1.1–1.5, Epic 2, 4.9/7.8 and the story split itself, cited by their A-number or content rather than AR number.

Partial coverage found on reading the acceptance criteria against the full FR text:

- **FR33 (lasso selection):** Story 5.1 covers click, Shift+click and marquee selection but not lasso (freeform) selection. Recommendation: add a lasso criterion to Story 5.1. Severity: minor.
- **FR14 ("markups saved per week"):** Story 10.9 reads activity, but only export/print events are recorded (Story 8.4). Recommendation: state in 10.9 that markups saved are counted from `markups.created_at`/author (no new event), or record `markup.saved` batches. Severity: minor.
- **NFR17 (session lifetimes):** no story states idle timeout 7 days, absolute 30 days and refresh-token rotation. Recommendation: add to Story 1.4. Severity: medium (security).
- **NFR38 (availability ≥99.5 %):** monitoring appears only in Story 13.6 (M4) although pilots use the product from M1. Recommendation: add uptime monitoring to Story 8.5. Severity: minor.
- **PRD success criterion "no training needed":** no story runs the 3-new-user unassisted test. Recommendation: add to Story 13.6 (or 10.14 with pilot users). Severity: minor.

### Coverage Statistics

- Total PRD FRs: 84
- FRs covered in epics: 84
- Coverage percentage: 100%

## UX Alignment Assessment

### UX Document Status

Found: `ux-design-specification.md` (complete, steps 1–14) plus the static mockup `ux-design-directions.html`. The UX spec was written after the architecture and before the epics, as A14 required.

### UX ↔ PRD Alignment

Aligned:
- Journeys: UX flows F1–F7 map to PRD J1–J6 (F1 first run ↔ J1, F2 save/sync ↔ NFR37/FR49–51/FR81, F3 4541 ↔ J6, F4 as-built finish ↔ J1, F5 reviewer ↔ J4, F6 sign-up ↔ J3/J5, F7 `.btx` ↔ J1/J3).
- A14 items are all defined: first-run flow, save/sync/fingerprint status model, 4541 panel with a defaults-only path to Place heads, and empty / loading / error / offline / pending-activation / image-only / partial-import states.
- FR69 (three themes, Blueprint default) and the "basic shortcut set in MVP" decision appear in both documents.
- FR75 circle/square overlay, FR77 non-blocking report, FR78 advisory notice and FR82 calibrate prompt match UX components.

UX items not in the PRD (acceptable refinements, no PRD change needed): exact shortcut keys (Revu defaults), HintBar, staged coverage reveal, colour tokens, breakpoints, the "undo history survives reload until the tab closes" rule.

### UX ↔ Architecture Alignment

Supported: Canvas2D scene graph with layered canvases (UX canvas components), three workers (non-blocking placement, fill, export), IndexedDB op queue (SaveIndicator offline states), Realtime for shared drawings (conflict toast), `tokens.ts` export for canvas colours, Tailwind v4 tokens, per-head coverage polygons (§9.5 hook).

Alignment issues (all minor, documentation-level):
1. **Themes:** architecture still says "dark workspace / light admin" (lines 80 and 127); UX and FR69 define three themes (Blueprint, Daylight, High contrast) via `[data-theme]`. Update the architecture wording.
2. **Worker name:** architecture Frontend section calls it `pdf.worker`; the project tree, mapping table and stories use `render.worker`. Use `render.worker` everywhere.
3. **Save states:** architecture process patterns list three states (`Saved` / `Saving…` / `Offline — n pending`); UX defines six (adds `Not synced — Retry`, `Local only — Sign in to save`, conflict toast). Point the architecture at the UX F2 table.
4. **UI libraries:** `radix-ui` 1.8.1 and `lucide-react` 1.58.0 were chosen in the UX spec and appear in the epics' install list but not in the architecture version table. Add them.
5. **Undo across reload:** UX-DR36 says undo history survives reload until the tab closes; the architecture keeps the undo stack in the in-memory store only. Decide the mechanism (serialize history to `sessionStorage`/IndexedDB per tab) in architecture, or relax the UX rule to "until reload".

### Warnings

- No blocking UX gaps. The mockup is static (layout and colour only); interaction details rely on the UX spec text, which is sufficient for stories.
- High contrast theme values are not yet drafted in the UX spec (only Blueprint and Daylight values). Story 1.6 must define them and pass the contrast checks.

## Epic Quality Review

Reviewed all 13 epics and 110 stories against the create-epics-and-stories standards: user value, epic independence, forward dependencies, sizing, acceptance criteria and table-creation timing.

### Best Practices Compliance

| Epic | User value | Independent | Sizing | No forward deps | Tables when needed | Clear ACs | FR trace |
|---|---|---|---|---|---|---|---|
| 1 Foundation & sign-in | ⚠️ partly technical (1.1–1.3, 1.5) | ✓ | ⚠️ 1.6 large | ⚠️ 1.4 → 1.6 styling | ✓ `profiles` only | ✓ | ✓ |
| 2 Risk spikes | ❌ technical by design | ✓ | ✓ | ✓ | ✓ none | ✓ | n/a (de-risks) |
| 3 Open & navigate | ✓ | ✓ | ✓ | ✓ | ✓ `profiles.theme` | ✓ | ✓ |
| 4 Calibrate & measure | ✓ | ✓ | ⚠️ 4.5 large | ✓ | ✓ none (calibration in memory) | ✓ | ✓ |
| 5 Markup & as-built | ✓ | ✓ | ✓ | ✓ | ✓ `signatures` | ⚠️ 5.5, 5.7 wording | ✓ |
| 6 Auto-save & lists | ✓ | ✓ | ⚠️ 6.2 dense | ✓ | ✓ drawings/files/pages/calibrations, markups | ✓ | ✓ |
| 7 Tool Chest | ✓ | ✓ | ✓ | ✓ | ✓ tool_sets/tools | ✓ | ✓ |
| 8 Flatten/export/print | ✓ | ✓ | ✓ | ✓ | ✓ activity_events | ✓ | ✓ |
| 9 4541 engine | ✓ | ✓ | ✓ (9.6 large, Fable) | ✓ | ✓ rule_figures, zones, zone_layouts | ✓ | ✓ |
| 10 Accounts & admin | ✓ | ✓ | ✓ | ✓ | ✓ audit_log, companies | ✓ | ✓ |
| 11 Sharing & review | ✓ | ✓ | ✓ | ✓ | ✓ shares, markup_events | ⚠️ 11.6 no latency target | ✓ |
| 12 Page edit & compare | ✓ | ✓ | ✓ | ✓ | ✓ none new | ⚠️ 12.5 spike metric open | ✓ |
| 13 Public site | ✓ | ✓ | ✓ | ✓ | ✓ none | ✓ | ✓ |

Starter template: ✓ Story 1.1 is the `create-next-app` scaffold with pinned dependencies. Greenfield setup (dev environment 1.1/1.3, CI 1.2/1.3) is early as required.

### 🔴 Critical Violations

1. **Epic 2 is a technical epic with no direct user value.** By the standard this is a violation. It is an explicit founder/architecture decision (A13: spikes before feature stories) and each spike de-risks named FRs/NFRs. **Accepted exception** — keep, but treat each spike as time-boxed with a go/change decision recorded in `docs/spikes/`.

No forward dependency breaks epic independence, and no epic-sized story remains unsplit (A15 splits are done).

### 🟠 Major Issues

1. **Story 1.6 is too large for one dev session** (three themes + 22 foundation components with tests + contrast CI). Remediation: split into 1.6a "Design tokens and themes" and 1.6b "Foundation components".
2. **Story 4.5 mixes the editor foundation with the first tool** (store, commands, markup schema, canvas layers + length/polylength). Remediation: split into 4.5a "Editor store, commands and markup schema with undo (proved by a simple length measurement)" and 4.5b "Polylength, captions and caption move", or accept as one large story assigned to Opus.
3. **Epic 1 stories 1.1–1.3 and 1.5 are developer-facing** ("As the founder"). Acceptable for a greenfield project (setup must exist), but they deliver no end-user value on their own. Accepted.
4. **NFR17 session lifetimes missing from Story 1.4** (idle 7 days, absolute 30 days, refresh-token rotation) — security criterion gap (from coverage step).

### 🟡 Minor Concerns

1. **Story 1.4 renders the PendingActivation screen before tokens exist (Story 1.6).** Works unstyled, but reordering 1.6 before 1.4 avoids rework. Remediation: move Story 1.6 (or 1.6a) ahead of 1.4.
2. **Vague wording:** 5.5 "cloud arcs scale with zoom consistently" (state: arc size fixed in page units, re-drawn per zoom), 5.7 "multiply-like transparency" (state: 40 % opacity multiply blend), 11.6 has no latency target (suggest ≤2 s p95 to the other client), 12.5 "documented accuracy" (acceptable for a spike, but name the fixture pairs).
3. **Story 6.2 is dense** (table, RPC, LWW, rate limit, benchmark). Cohesive; keep, but assign to Opus.
4. **FR33 lasso selection** missing from Story 5.1; **FR14 "markups saved" metric source** unstated in 10.9; **NFR38 uptime monitoring** only at M4 (13.6) although pilots start at M1; **"no training needed" test** has no story.
5. **UX ↔ architecture wording drift** (from UX step): themes, worker name, save states, UI library versions, undo-across-reload mechanism.

### Dependency Map Check

Within-epic order verified for all epics after the step-4 fixes in epics (1.4 sign-out moved to a user menu; email provider moved to 10.1; first-use tips split into 4.3/7.3/9.2; calibration persisted in 6.1). Cross-epic references point only backwards (e.g. 9.8 → legend 7.8, 9.12 → export dialogs 8.1, 12.1 → thumbnails 3.4, 13.4 → sign-up 10.1). Story 9.2's "company default mapping" falls back to the platform default until Epic 10 adds company mappings, so it does not depend on Epic 10.

## Summary and Recommendations

### Overall Readiness Status

**READY WITH MINOR FIXES** — implementation can start with Epic 1 once the four quick fixes below are applied to the epics (about 30 minutes of edits). No critical gap blocks Story 1.1.

Evidence: 84/84 FRs, 47/47 NFRs and 40/40 UX-DRs are cited by stories; tables are created only where first needed; no forward dependency between epics; the riskiest bets (placement) already have a working spike with zero oracle errors.

### Critical Issues Requiring Immediate Action

None blocking. The one rule-level critical item (Epic 2 is a technical epic) is an accepted founder decision.

Fix before the affected story starts:
1. **Story 1.4:** add NFR17 session lifetimes (idle 7 days, absolute 30 days, refresh-token rotation).
2. **Story 1.6:** split into 1.6a tokens/themes and 1.6b foundation components, and move 1.6a before 1.4.
3. **Story 4.5:** split editor foundation from the measurement tools (or accept as one Opus-sized story).
4. **Architecture wording:** three themes, `render.worker` name, six save states (point to UX F2), add `radix-ui` 1.8.1 / `lucide-react` 1.58.0, and decide undo-across-reload (sessionStorage/IndexedDB per tab, or relax UX-DR36).

### Recommended Next Steps

1. Apply the four fixes above, plus the minor wording items (5.1 lasso, 5.5/5.7 wording, 10.9 metric source, 11.6 latency target, uptime monitoring in 8.5, "no training needed" test in 13.6).
2. Run `bmad-sprint-planning` to create `sprint-status.yaml` from `epics.md`.
3. Start Story 1.1 (scaffold) — model: Sonnet is enough for 1.1–1.2; Opus for 1.3–1.5 (security) and the Epic 2 spikes 2.1, 2.3, 2.4; Fable for 2.2.

### Final Note

This assessment identified **15 issues across 4 categories** (1 accepted critical, 4 major, 10 minor; categories: FR/NFR coverage, UX ↔ architecture alignment, story sizing, acceptance-criteria wording). None blocks the start of implementation. Address the major items before the stories they touch; the minor items can be fixed in passing.

**Assessed:** 2026-10-17 by the implementation-readiness workflow (Claude, Opus) for founder Cchoi.

## Fixes Applied (2026-10-17, after the assessment)

- Story 1.6 split: new **1.4 Design tokens and themes** (moved before sign-in) and **1.7 Foundation components**; sign-in became 1.5, security headers 1.6, empty workspace shell 1.8.
- Story 1.5 (sign-in) now states NFR17 session lifetimes (refresh rotation, idle 7 days, absolute 30 days).
- Story 4.5 split: **4.5 Length measurement (editor foundation)** with per-tab undo history in `sessionStorage`, and new **4.6 Polylength and measurement captions**; former 4.6–4.10 renumbered 4.7–4.11.
- Minor fixes: lasso selection (5.1), cloud arc and highlight wording (5.5, 5.7), "markups saved" metric source (10.9), Realtime ≤2 s p95 (11.6), compare spike fixtures (12.5), uptime monitoring in M1 readiness (8.5), "no training needed" test in launch readiness (13.6).
- Architecture: three themes, `render.worker` name, six save states (UX F2), `radix-ui` 1.8.1 and `lucide-react` 1.58.0 in the version table, undo history serialised per tab.
- Re-check: 84/84 FRs, 47/47 NFRs, 40/40 UX-DRs cited; 112 stories.

**Status after fixes: READY.**
