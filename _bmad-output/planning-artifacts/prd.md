---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
releaseMode: phased
classification:
  projectType: saas_b2b (vertical, fire protection) + web canvas app
  domain: construction / fire protection (drawing markup, as-built)
  complexity: high (canvas editor + multi-tenant SaaS + sprinkler layout engine; life-safety adjacent)
  projectContext: greenfield
inputDocuments:
  - docs/feature-inventory.md
  - docs/prior-art-sprinkler-drafter.md
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 1
workflowType: 'prd'
---

# Product Requirements Document - plan-markup

**Author:** Cchoi
**Date:** 2026-10-15 · **Last updated:** 2026-10-16
**Status:** Complete (working product name: plan-markup)


## Executive Summary

plan-markup is a browser-based PDF drawing markup tool for fire protection
companies (sprinkler and fire alarm contractors and designers). It covers the
subset of Bluebeam Revu that fire drawing work actually uses — markup,
calibrated measurement, a reusable symbol tool chest, a markups list, page
editing, flatten — and is built around the as-built workflow: erase or
white-out original design content, redraw installed devices and pipework,
cloud the changes, produce a legend and revision stamp, and export a flattened
PDF. Its **4541 engine** divides a calibrated drawing into zones, assigns each
zone a use and NZS 4541 hazard class (ELH, OH1–OH3), and automatically places
sprinkler heads in optimised positions within the rules — for rectangular and
irregular rooms — with a coverage overlay to confirm nothing is missed.

Revu is heavy, install-only, and must be learned even for simple jobs.
plan-markup runs in the browser with no install and is usable without
training. Drawings stay on the user's machine by default; only markup data is
stored on the server, keyed to the PDF, so work can be resumed and shared.
Saving the PDF to the server is an optional per-drawing setting.

Users sign up as individuals and can be grouped into companies; roles
(admin / member / viewer) are granted at company level. The platform owner
administers all users and companies. The product is sold as SaaS to multiple
companies; billing is deferred past MVP.

### What Makes This Special

- **4541 engine** — automatic, rule-bounded sprinkler head placement for any
  room shape, tunable wall distance and head spacing, and a coverage overlay;
  layouts are advisory and editable, the designer stays responsible.
- **Only what fire drawing work needs** — a focused tool set a new user can
  operate on first open, instead of a full Revu clone.
- **Bring your own tool chest** — own symbol-library format, with one-time
  import of existing Revu `.btx` tool sets (e.g. Sprinkler Tools, Fire Alarm
  Tools), so existing symbol libraries carry over.
- **As-built first** — non-destructive erase/white-out of original content,
  dynamic fill for areas, auto legend with counts, revision stamp.
- **Drawings stay local by default** — a selling point for contractors who
  cannot put client drawings in third-party clouds.
- **Core insight:** fire protection users touch a small, stable fraction of
  Revu. Doing that fraction well on the web is cheaper, lighter and faster to
  learn than the full desktop product. Proven pieces (dynamic fill, scale
  detection, vector snapping, PDF export) are ported from the founder's
  earlier sprinkler drafter.

## Project Classification

- **Project type:** Vertical B2B SaaS (fire protection) + web canvas application
- **Domain:** Construction / fire protection — drawing markup and as-built documentation
- **Complexity:** High — PDF canvas editor (rendering, measurement, flatten/export), multi-tenant SaaS (users, companies, roles, sharing) and a sprinkler layout optimisation engine (life-safety adjacent: advisory output, designer responsible)
- **Project context:** Greenfield; reuses algorithms from the founder's prior single-file prototype
- **Out of MVP:** automatic obstruction avoidance (obstruction library with height-based baffling planned for Growth — decided 2026-10-17), ceiling-tile snapping for general markups (4541 placement aligns heads to a user-declared tile grid in MVP — decided 2026-10-16), hazard classes beyond ELH/OH1–OH3, certificate-based digital signatures, tablet mode, full/customisable keyboard shortcuts (a basic set ships in MVP — decided 2026-10-16), billing

## Success Criteria

### User Success

- **Founder replaces Revu for one week:** the founder completes all real
  as-built and drawing markup work for 5 consecutive working days without
  opening Revu (other, specialised Revu tasks are allowed).
- **Tool chest carries over:** importing the founder's Revu tool sets
  (Sprinkler Tools 66, Fire Alarm Tools 56, My Tools 16 = 138 items)
  reproduces ≥95% of items correctly (see Architecture Inputs A9).
- **No training needed:** 3 new users from pilot companies each complete open PDF
  → calibrate → place symbols → cloud changes → export flattened PDF without
  written instructions.
- **4541 engine saves time:** on 3 of the founder's real office drawings,
  auto-placement plus manual touch-up is faster than manual head placement,
  every zone (including irregular ones) has heads, and the coverage overlay
  shows no gaps.
- **Work is never lost:** reopening the identical PDF restores all markups.
  A re-saved or re-issued PDF is a new drawing by design; users who need
  continuity turn on server PDF storage.

### Business Success

- **Launch** = M4 gate passed (public marketing site live, pilot onboarding open).
- **3 months after launch:** 3 companies using it weekly for real jobs.
- **12 months after launch:** 15 companies using it weekly.
- "Weekly use" = at least one exported PDF or ≥20 saved markups per company per week.
- Pricing set below Revu per-seat cost (billing ships post-MVP; pilots
  onboarded manually by the platform admin).

### Technical Success

- 50 MB / A0 vector PDF: first page visible in ≤3 s on a mid-range laptop.
- Pan/zoom stays smooth (target 60 fps, never below 30 fps) with 500 markups on a page.
- Measurements are exact against calibration (no rounding drift between screen
  and exported PDF).
- Tenant isolation: no user can read another company's or user's markup data
  (RLS-enforced, smoke-tested in CI from day 1).
- Drawings never leave the browser unless the user turns on server PDF storage
  for that drawing.

### Measurable Outcomes

| Outcome | Target | When |
|---|---|---|
| Founder as-built/markup work without Revu | 5/5 days | M1 gate |
| .btx import fidelity | ≥95% of items | MVP |
| 4541 engine on founder's office drawings | 3/3 drawings faster than manual, full coverage | M2 gate |
| First render, 50 MB A0 PDF | ≤3 s | MVP |
| Pan/zoom with 500 markups | ≥30 fps (target 60) | MVP |
| Weekly active companies | 3 | Launch + 3 months |
| Weekly active companies | 15 | Launch + 12 months |
| Cross-tenant data leaks | 0 (CI RLS suite green) | Always |

## Product Scope

### MVP - Minimum Viable Product

Capability summary. Build order and milestone gates (M1–M4) are in
*Project Scoping & Phased Development*; the binding list is *Functional Requirements*.

- **Accounts & admin:** email login required; individual users; companies with
  admin / member / viewer roles; platform admin console (users, companies,
  activation, roles).
- **Viewer:** open local PDF, multi-document tabs, page navigation, zoom/pan,
  fit page/width, rotate view, thumbnails, text search.
- **Layout:** Revu-like structure — top toolbar, right tool rail, left panel
  rail (Tool Chest, Measurements, Properties, Thumbnails), bottom Markups List,
  status bar with page size and current scale.
- **Signature & compare:** signature stamp (drawn or uploaded signature with
  name/date); document compare between two revisions with colour-coded
  differences (M4).
- **Markup:** select/lasso, pen, highlight, typewriter, line, arrow, polyline, polygon,
  rectangle, ellipse, cloud, cloud+, callout, text box, note, stamp, image,
  dimension; underline/strikethrough; group, align, z-order, lock, format
  painter, copy/paste, undo/redo; snap to vector endpoints/midpoints/intersections.
- **As-built:** non-destructive erase / white-out of original content; revision
  stamp; auto legend (symbols used + counts).
- **Measurement:** calibration dialog (two-point or ratio, per page or range,
  separate Y scale, precision) with scale auto-detection from drawing text;
  length, polylength, area, count, angle, radius, diameter; dynamic fill.
- **Tool Chest:** own tool set format; create/edit tool sets; import Revu `.btx`.
- **Markups List:** subject, page label, comments, date, author, status,
  colour, layer; sort, filter, CSV export.
- **Page editing:** insert, delete, extract, replace, rotate, reorder, crop, merge PDFs.
- **Flatten / export:** flatten all / filtered / selected markups, allow
  unflatten; export PDF.
- **Storage & sharing:** markup data on server keyed to PDF fingerprint;
  optional per-drawing server PDF storage; share a drawing's markups with
  users; recipient without the PDF gets a markup-only view + prompt.
- **Persistence:** markups restored only for the identical PDF (exact fingerprint); no fuzzy matching, relink or revision carry-over in MVP.
- **4541 engine:** zones by dynamic fill or polygon; use → hazard class (ELH,
  OH1, OH2, OH3) with auto-populated rule figures; automatic optimised head
  placement for any zone shape; tunable preferred wall distance and head
  spacing within rules; coverage overlay (circle/square, toggle); manual
  adjustment for obstructions; advisory notice.
- **Layers, print, theme:** markup layers (show/hide/lock), printing, dark
  theme by default.

### Growth Features (Post-MVP)

- Billing and subscription plans (Stripe).
- 4541 obstruction library (decided 2026-10-17): a library of obstruction objects (rectangle, circle, L-shape, free polygon; e.g. duct, beam, light fitting, cable tray, partition) that users place on the drawing. Each object has a height model: full-height (acts as a wall) or suspended (depth below ceiling / bottom elevation). Coverage shapes update live with spray shadows behind obstructions; placement and the independent checker apply the NZS 4541 obstruction rules (figures to be confirmed by the founder against the standard). Design: `docs/4541-placement-design.md` §9.
- 4541 engine extensions: automatic ceiling-tile detection and thirds alignment, more hazard classes (OH4, HH), pipe routing.
- Certificate-based (PKI) PDF digital signatures.
- Real-time collaborative sessions.
- Tablet mode (view + inspection marks).
- Customisable keyboard shortcuts.
- Multi-factor authentication (TOTP), mandatory for admins.
- Markup summary PDF report, custom Markups List columns.

### Vision (Future)

- Fire-protection workspace: projects, drawing sets, issue registers.
- AU expansion (AS 2118 rule profiles).
- Integrations with fire impairment / inspection tools.
- Symbol recognition: detect and count existing symbols on a drawing.

## User Journeys

### J1 — As-built drafter, happy path (primary)

**Sam, sprinkler as-built drafter at a 12-person Auckland contractor.**
Sam does as-builts in Revu every day but resents the licence, the install on
every PC, and the menus they never use.

- **Opening:** Site has finished level 3. Sam has the architect's RCP PDF and
  marked-up site sheets. They open plan-markup in the browser, sign in, drag
  the PDF in. It renders in under 3 s; the PDF never leaves the laptop.
- **Rising action:** The status bar shows "Scale: 1:100 @ A1 detected — verify".
  Sam checks it against a 4400 grid dimension and accepts. From the Tool Chest
  (their Sprinkler Tools set, imported from Revu on day one) they white-out the
  design heads that moved, stamp the installed heads, draw branch lines with
  polyline and label pipe sizes, cloud every change, and use dynamic fill to
  get a room area.
- **Climax:** Sam clicks Legend — symbols used and counts appear in a box on
  the sheet. A revision stamp adds "Rev C — as-built — Sam — date".
- **Resolution:** Flatten → Export PDF. Done in less time than in Revu. Next
  morning they reopen the same PDF and every markup is still there.

**Reveals:** local PDF open, scale detection + verify, Tool Chest + .btx
import, erase/white-out, stamps, polyline + labels, cloud, dynamic fill,
legend, revision stamp, flatten/export, markup persistence by exact fingerprint.

### J2 — As-built drafter, edge cases

- **Re-saved or re-issued PDF:** The main contractor re-issues the sheet
  after re-saving it in another tool. plan-markup treats it as a new drawing
  and opens it clean. Sam's earlier markups remain on the original PDF.
  Sam's company now keeps server PDF storage on for jobs that run across
  several issues.
- **Wrong scale caught:** Sam measures before calibrating; the length shows
  "Scale not set" in the warning colour instead of a number.
- **Big set:** A 60-page set is too much; Sam extracts the 4 sprinkler sheets
  into a new PDF and works on those.

**Reveals:** exact-fingerprint persistence (a changed file is a new drawing),
uncalibrated-measure warning, page extract/merge, optional server PDF storage.

### J3 — Company admin

**Priya, operations manager at the same contractor.** Priya receives
company-admin access from the platform admin and invites three drafters
(member) and the project manager (viewer). Priya publishes the company's
Sprinkler and Fire Alarm tool sets so every member uses identical symbols.
When a drafter leaves, Priya removes them; markups they authored stay with
the drawings they shared.

**Reveals:** company invitations, roles (admin/member/viewer), shared company
tool sets, member removal, data ownership on departure.

### J4 — Viewer (reviewer)

**Mark, project manager at the main contractor.** Sam shares the L3 drawing
with Mark by email. Mark signs up from the invitation and is in straight away
(limited to what was shared — no waiting for activation). Sam has switched on server PDF storage for this drawing, so Mark
opens the link and sees PDF + markups straight away. Mark cannot draw, but
can set markup status (Accepted / Rejected) and add comments in the Markups
List. If the drawing had no server copy, Mark would see markups on a blank
page with "Open L3 RCP Rev C (4 pages) to view the drawing".

**Reveals:** sharing, viewer permissions (status + comments only), optional
server PDF, markup-only view without the PDF.

### J5 — Platform admin (founder)

**The founder onboards a pilot company.** Creates the company, assigns its
first admin, activates their accounts and sets the plan field (no billing
yet). The admin console lists users, companies, last activity and weekly
exports — the founder's 3-month / 12-month success metric.

**Support case:** A pilot user reports "my markups disappeared". The founder
looks up the user's markup sets by filename, sees they were made on a
different file than the one now open, and explains that markups follow the
exact PDF. The founder suggests opening the original file or turning on server
PDF storage. The founder never sees the drawing itself.

**Reveals:** platform admin console (companies, users, activation, roles,
plan field), activity metrics, support lookup of markup sets by filename,
admin cannot view drawings that were not uploaded.

### J6 — Sprinkler designer, 4541 engine

**Sam again, this time laying out a new office fit-out.**

- **Opening:** A 600 m² office floor plate with an L-shaped open plan, a
  triangular meeting room against a diagonal façade, a kitchen and a storage
  room. Previously Sam spaced heads by hand with measurement tools for an hour.
- **Rising action:** Sam calibrates, dynamic-fills each room into zones and
  draws a polygon for the triangle. Picks uses: Office, Kitchen, Storage; the
  hazard class and rule figures fill in automatically.
- **Climax:** Sam clicks Place heads. Heads appear in every zone, including the
  L-shape and the triangle. Sam turns on the coverage overlay — translucent
  circles show no gaps. Sam nudges preferred wall distance to 1.2 m and
  re-runs; spacing evens out.
- **Resolution:** Sam drags two heads off light fittings, checks the per-zone
  panel (no rule breaks), and the legend counts the new heads. The advisory
  notice reminds Sam the design remains theirs to verify.

**Reveals:** zones by fill/polygon, use → hazard mapping, auto rule figures,
automatic placement for irregular zones, preferences, coverage overlay
(circle/square), manual adjustment, per-zone stats/warnings, advisory notice.

### Journey Requirements Summary

| Capability area | Journeys |
|---|---|
| Auth, sign-up, invitations | J1, J3, J5 |
| Company + role management (admin/member/viewer) | J3, J5 |
| Platform admin console + activity metrics | J5 |
| Local PDF viewer + performance | J1, J2 |
| Scale detection, calibration, uncalibrated warning | J1, J2 |
| Markup tools, snapping, as-built erase/white-out | J1 |
| Tool Chest: own format, .btx import, company-shared sets | J1, J3 |
| Measurement + dynamic fill | J1 |
| Legend, revision stamp | J1 |
| Markups List: status, comments, filter, CSV | J1, J4 |
| Page editing (extract, merge, etc.) | J2 |
| Flatten / export | J1 |
| Markup persistence — identical PDF only (exact fingerprint) | J1, J2, J5 |
| Sharing, optional server PDF, markup-only view | J2, J4 |
| Support lookup without access to drawing content | J5 |
| 4541 engine: zones, hazard mapping, auto placement, overlay | J6 |

## Domain-Specific Requirements

### Compliance & Regulatory

- **NZ Privacy Act 2020:** user account data (name, email, company) handled per
  the 13 Information Privacy Principles; privacy policy and breach notification
  process before pilots.
- **Clean-room / IP:** no Bluebeam code, assets, icons or trademarks in the
  product or marketing. Features derived only from public documentation and
  user observation. Revu `.btx` import exists for interoperability with the
  user's own data.
- **NZS 4541 rule figures:** default figures for ELH, OH1, OH2, OH3 and the
  default use → hazard mapping ship with the product (founder decision). They
  must be confirmed once by the founder against a licensed copy of NZS 4541
  before release, and are maintainable by the platform admin when the standard
  changes.
- **Life-safety positioning:** automatic layouts are advisory. The product
  states on screen (and optionally on exports) that the designer remains
  responsible for compliance; marketing never claims compliance.

### Technical Constraints

- **Client drawing confidentiality:** drawings are client IP. Default is no
  upload; server PDF storage is opt-in per drawing, clearly labelled, and
  removable (delete from server).
- **Data residency:** server data (accounts, markups, optional PDFs) hosted in
  Australia/NZ region.
- **PDF fidelity:** exported PDFs open correctly in Revu, Adobe Acrobat and
  browser viewers; non-flattened markups exported as standard PDF annotations
  (ISO 32000) so they stay editable in other tools.
- **Drawing conventions:** metric units (mm/m) by default, A-series sheet sizes
  (A0–A4) recognised, scale ratios as printed on NZ title blocks.
- **Mixed PDFs:** drawings where the architecture is an embedded image (no
  vectors) must still open, measure and mark up; snapping and dynamic fill
  degrade gracefully.
- **Audit trail:** every markup records author, created/modified time and
  status changes (who accepted/rejected what, when).
- **Input format:** PDF only. CAD files (DWG/DXF) are out of scope — no
  import, conversion or editing.

### Integration Requirements

See *Integration List* under B2B SaaS + Web Canvas App Specific Requirements.

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Client objects to drawings in the cloud | Local-only default; server storage opt-in per drawing; deletion on request |
| Bluebeam IP claim | Clean-room record (`docs/feature-inventory.md` sources), no copied assets, own icon set, no "Bluebeam" in product naming |
| Exported PDF misreads in Revu/Acrobat | Export test suite against sample drawings opened in Acrobat + Revu |
| Image-only drawings break tools | Detect and inform; manual calibration and drawing still work |
| Wrong rule figures or mis-classified zone lead to an unsafe layout | Founder-verified defaults; hazard class and figures visible per zone; per-zone rule-break warnings; advisory notice |

## Innovation & Novel Patterns

### Detected Innovation Areas

1. **Local-first drawings, cloud markups.** The PDF never leaves the browser
   by default; only markup data (vector geometry, text, metadata) is stored
   server-side, keyed to the exact PDF fingerprint. Competing web tools
   (Bluebeam Cloud, Drawboard, Procore) require uploading the drawing. This
   makes collaboration possible for contractors whose clients forbid
   third-party cloud storage of drawings.
2. **Device-aware symbols instead of dumb stamps.** A Tool Chest item is a
   typed device (group, label, description, symbol), not just a picture. Every
   placed symbol therefore knows what it is, so the legend, counts per device
   type and CSV quantities are generated automatically. In Revu, stamps are
   images and counting needs separate count-measurement tools.
3. **Live dynamic fill.** Area takeoff by holding the mouse inside a room: the
   fill spreads in real time and walls stop it, with brush paint/erase and
   stroke undo. Already proven in the founder's prototype.
4. **4541 engine.** Rule-bounded automatic head placement that works on
   irregular polygons (the founder's prototype only handled rectangles),
   with designer-tunable preferences and a coverage overlay. No web markup
   tool offers this; sprinkler CAD tools do, at design-tool cost and complexity.
5. **Zero-friction migration.** One-time import of Revu `.btx` tool sets turns
   a user's existing symbol library into typed devices, removing the main
   switching cost.

### Market Context & Competitive Landscape

- Web PDF markup is an established category (Bluebeam Cloud, Drawboard
  Projects, Procore/ACC markup); all are upload-first and generic across trades.
- Sprinkler CAD tools (AutoSPRINK, HydraCAD, SprinkCAD) are design-grade,
  expensive and over-specified for as-built markup.
- AI takeoff tools (Togal, Kreo) auto-detect rooms/areas but target
  estimators, not fire as-builts. Competitor capabilities are from general
  knowledge and need verification before marketing claims.
- The gap: a fire-trade-specific, local-first, no-training markup tool.

### Validation Approach

| Innovation | How we validate | Pass signal |
|---|---|---|
| Local-first + cloud markups | Ask pilot companies whether "drawings never uploaded" affects their decision | ≥2 of first 3 pilots cite it as a reason to adopt |
| Device-aware symbols | Founder's as-built week: legend/counts generated vs manual counting | Zero manual recounts during the week |
| Live dynamic fill | Time area takeoff vs Revu on 5 real rooms | Equal or faster, area within 1% of Revu |
| .btx migration | Import founder's 3 tool sets (138 items) | ≥95% items pass A9 criterion |
| 4541 engine | Founder's 3 office drawings incl. irregular rooms | M2 gate met (see Success Criteria) |

### Risk Mitigation

| Risk | Fallback |
|---|---|
| Customers don't value local-first | Server PDF storage already exists as an opt-in; flip the default per company |
| `.btx` appearance streams too varied to render faithfully | Import as image stamps with device metadata; user re-assigns symbol if needed |
| Dynamic fill fails on dense or image-only drawings | Manual polygon area tool always available; fill leak detection with guidance |
| Device typing adds friction when placing quick marks | Plain stamps/markups remain available; typing optional per tool |

### Future Innovation Candidates (not MVP)

- **Symbol recognition:** detect existing sprinkler/alarm symbols already on a
  drawing and count them automatically.
- Obstruction-aware placement (obstruction library with height-based baffling, Growth) and pipe routing on top of the 4541 engine.

## B2B SaaS + Web Canvas App Specific Requirements

### Project-Type Overview

Multi-tenant B2B SaaS delivered as a single-page canvas application in the
browser. Two surfaces with separate routes and layouts: the **workspace**
(dark, Revu-like drawing editor) and **admin** (light, conventional SaaS
screens for company and platform administration). A separate public
marketing site serves SEO and AI discoverability.

### Tenant Model

- **User** is the base account. Every user can work without a company
  ("individual").
- **Company** is an optional grouping. A user belongs to at most one company
  in MVP.
- **Owned data:** markup sets and personal tool sets are owned by the user who
  created them. Company tool sets are owned by the company.
- **Sharing:** a markup set owner shares it with specific users by email,
  inside or outside their company, granting edit or view. Recipients must have
  an account.
- **Departure:** when a user is removed from a company, their own markup sets
  stay theirs; company tool sets stay with the company; shares they granted
  remain until revoked.
- **Activation:** new sign-ups are pending until the platform admin activates
  them (pilot-controlled launch). Sign-ups from a share invitation are
  auto-activated with access limited to what was shared.
- **Platform admin** sits above all tenants and can manage any user/company
  but cannot see drawing content that was never uploaded.

### RBAC Matrix

| Capability | Platform admin | Company admin | Member | Viewer | Individual |
|---|---|---|---|---|---|
| Open local PDF, create/edit own markups | ✓ | ✓ | ✓ | — | ✓ |
| View shared markup sets | ✓ | ✓ | ✓ | ✓ | ✓ |
| Change status / add comments on shared markups | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit others' markups (when shared with edit) | — | ✓ | ✓ | — | ✓ |
| Share own markup sets | ✓ | ✓ | ✓ | — | ✓ |
| Turn on server PDF storage for own drawing | ✓ | ✓ | ✓ | — | ✓ |
| Create personal tool sets, import `.btx` | ✓ | ✓ | ✓ | — | ✓ |
| Run 4541 engine on own drawings | ✓ | ✓ | ✓ | — | ✓ |
| Publish / edit company tool sets | — | ✓ | — | — | — |
| Edit company use → hazard mapping | — | ✓ | — | — | — |
| Maintain default rule figures and use → hazard mapping | ✓ | — | — | — | — |
| Invite / remove company users, assign roles | — | ✓ | — | — | — |
| Create companies, activate users, set plan field | ✓ | — | — | — | — |
| View platform activity metrics | ✓ | own company only | — | — | — |

Enforcement in the database (row-level security) with one access-check
helper per resource, smoke-tested per role × table in CI from day 1.

### Subscription Tiers

- No billing in MVP. `plan` field on company and individual accounts
  (`trial`, `pilot`, `standard`) set manually by the platform admin.

### Integration List

- Revu `.btx` tool set import (one-way).
- CSV export (markups, counts per device).
- Transactional email (invitations, password reset, activation).
- None other in MVP.

### Compliance Requirements

See Domain-Specific Requirements (NZ Privacy Act 2020, clean-room IP,
AU/NZ data residency, drawing confidentiality).

### Browser Matrix

- Desktop Chrome and Edge (latest 2 versions): fully supported.
- Desktop Firefox and Safari (latest): supported, best effort.
- Minimum viewport 1280×720. Tablets/phones out of MVP (admin screens may
  work but are not tested).

### Responsive Design

- Workspace targets desktop only; panels collapse to give the canvas space on
  1280-wide screens.
- Admin screens responsive down to 768 px. Marketing site fully responsive.

### Performance Targets

See NFR1–NFR7. Approach: PDF rendering and the 4541 engine run off the main
thread; visible-region detail re-render at high zoom.

### SEO & AI Discoverability Strategy

Goal: rank in Google and be cited by AI assistants (ChatGPT, Claude,
Perplexity, Google AI Overviews) for queries such as "fire protection PDF
markup", "sprinkler as-built drawing tool", "browser alternative to desktop
PDF markup software".

- **Public marketing site** (separate from the app, statically generated or
  server-rendered so crawlers get full HTML): home, features (one page per
  feature: markup, measurement, dynamic fill, tool chest, as-built, page
  editing), use cases (sprinkler as-builts, fire alarm as-builts), pricing,
  security & privacy ("drawings stay on your computer"), FAQ, blog/guides.
- **Public help centre / guides** indexed — how-to articles answer the exact
  questions people ask search engines and AI assistants.
- **Structured data (JSON-LD):** `SoftwareApplication` (category, OS = web,
  offers), `Organization`, `FAQPage`, `HowTo` on guides, `BreadcrumbList`.
- **Technical SEO:** unique title/description per page, canonical URLs,
  `sitemap.xml`, `robots.txt`, Open Graph/Twitter cards, fast Core Web Vitals
  (LCP ≤2.5 s, CLS ≤0.1), semantic headings, alt text, NZ English, `en-NZ`
  locale with AU as secondary.
- **AI crawlers:** `robots.txt` explicitly allows GPTBot, ClaudeBot,
  PerplexityBot, Google-Extended and similar on marketing/help pages;
  publish `/llms.txt` summarising the product, features, pricing and key
  pages in plain text.
- **Answer-friendly content:** each feature/FAQ page opens with a 1–2
  sentence direct answer, then detail; factual claims (formats, limits,
  privacy model) stated plainly so assistants can quote them.
- **Comparison content:** comparison pages against named competitors only
  with factual, verifiable claims and no use of their logos/trade dress.
- **App routes** (`/app`, `/admin`, shared links) are `noindex` and
  disallowed in `robots.txt`.
- **Measurement:** Google Search Console + Bing Webmaster Tools from launch.

### Accessibility Level

- Admin screens and marketing site: WCAG 2.1 AA.
- Workspace: keyboard focus for toolbars, panels and dialogs; colour is never
  the only signal; the canvas itself is exempt from full screen-reader support.

### Technical Architecture Considerations

- Canvas editor state (tools, selection, undo/redo) lives outside the React
  tree in a dedicated store; avoid giant client components.
- Markups stored as rows (geometry in PDF user-space coordinates + style +
  metadata), queryable for the Markups List, legend and CSV.
- Calibration stored per page.
- Coordinates in one canonical space; mm only at display.
- Pure geometry/fill/scale/4541-engine logic in a framework-free module with unit tests
  that run the shipped code (pattern from the prior prototype).

### Implementation Considerations

- Day 1: auth helper, RLS helper functions, schema-drift + RLS smoke-test CI.
- Port proven prototype modules (dynamic fill, scale detection, vector snap,
  geometry, export) into the core module with their existing tests.
- Workspace, admin and marketing are separate route groups with separate layouts.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP, proven first on the founder's own
daily work, then opened to pilot companies. The MVP is complete when the
founder does a full week of as-built and markup work without Revu (M1 gate) and three pilot companies
can be onboarded and collaborate (M3–M4 gate). The 4541 engine (M2) is the
core differentiator and is proven on the founder's own office drawings.

**Resource Requirements:** Solo founder (fire protection domain expert,
product owner, platform admin) building with AI-assisted development. Stack:
Next.js + Supabase (AU region) + pdf.js + pdf-lib. No dedicated designer;
UI follows the near-sharp design system.

### MVP Feature Set (Phase 1) — built in milestone order

**M1 — Founder-usable workspace (gate: founder's as-built/markup week without Revu)**
- Typewriter tool and signature stamp.
- Login (single account is enough), local PDF open, tabs, navigation, zoom/pan.
- Revu-like layout: top toolbar, right tool rail, left panel rail, bottom
  Markups List, status bar.
- Calibration (detected scale + verify, two-point, per page), measurement
  tools, dynamic fill, vector snapping.
- Markup tools + as-built erase/white-out.
- Tool Chest: own format, typed devices, `.btx` import.
- Auto legend, revision stamp.
- Markups saved to server per exact PDF fingerprint; reopen restores.
- Flatten / export PDF.

**M2 — 4541 engine (gate: on 3 of the founder's real office drawings, auto-placement + manual touch-up is faster than manual placement and the overlay shows full coverage)**
- Zones by dynamic fill or polygon; use → hazard class (ELH, OH1–OH3).
- Auto-populated, founder-verified rule figures; company-editable use mapping.
- Automatic optimised head placement for rectangular and irregular zones
  (algorithm designed with Claude Fable; test cases from prototype failures).
- Preferred wall distance / head spacing controls; re-run placement.
- Coverage overlay (circle / square, toggle); per-zone stats and rule-break warnings.
- Manual head move/add/delete; advisory notice.

**M3 — SaaS foundation (gate: first pilot company onboarded)**
- Sign-up with pending activation, password reset, email.
- Companies, roles (admin / member / viewer), invitations, removal.
- Platform admin console: users, companies, activation, plan field,
  activity metrics, support lookup by filename.
- Company tool sets.
- RLS + CI smoke tests (built from day 1, extended here).

**M4 — Collaboration & pilot polish (gate: 3 pilot companies weekly)**
- Sharing markup sets by email (edit / view), viewer status + comments.
- Optional per-drawing server PDF storage + delete; markup-only view.
- Markups List full: status, comments, filters, CSV.
- Page editing: insert, delete, extract, replace, rotate, reorder, crop, merge.
- Document compare between two revisions (colour-coded differences, auto-cloud).
- Flatten options (filtered / selected / unflatten).
- Public marketing site + help centre with SEO / AI discoverability.

**Core User Journeys Supported:** J1 (M1), J2 (M1/M4), J6 (M2), J3 + J5 (M3), J4 (M4).

### Post-MVP Features

**Phase 2 (Growth)** and **Phase 3 (Vision):** as listed under *Product Scope*
(Growth Features, Vision). Symbol recognition (Innovation) belongs to Vision.

### Risk Mitigation Strategy

**Technical Risks:**
- Canvas editor performance on A0 drawings → prototype rendering + 500-markup
  stress test in the first M1 week before building tools on top.
- `.btx` appearance-stream fidelity → spike import of the founder's 3 tool
  sets early in M1; fallback to image stamps with device metadata.
- Exported PDF compatibility → test exports in Acrobat and Revu from M1.
- Placement algorithm on irregular rooms (the prototype's failure point) →
  design with Claude Fable starting from a named test suite of irregular
  zones (L-shape, triangle, diagonal wall, corridor); accept "auto + manual
  touch-up" as the fallback quality bar.

**Market Risks:**
- Small NZ market → validate willingness to switch with 3 pilots before
  billing; local-first privacy and no-training as lead messages.
- Bluebeam Cloud bundled in Revu subscriptions → compete on fire-specific
  workflow and price, not breadth.

**Resource Risks:**
- Solo build → strict milestone gates; M1 alone delivers founder value even if
  M2–M4 slip; anything not needed for a gate waits.

## Functional Requirements

Milestones: M1 workspace · M2 4541 engine · M3 SaaS foundation · M4 collaboration & polish.

### 1. Accounts & Access
- FR1: Visitors can sign up with email and password; new accounts stay pending until activated by the platform admin. Users who sign up through a share invitation are activated automatically but can only open what was shared with them until the platform admin activates them fully. (M3/M4)
- FR2: Users can sign in, sign out and reset their password by email. (M1/M3)
- FR3: Users can use every workspace capability without belonging to a company. (M1)
- FR4: Users can view and edit their own profile (name, email). (M3)
- FR5: The system blocks all app and data access for unauthenticated or pending users. (M1)

### 2. Companies & Roles
- FR6: Company admins can invite users to their company by email. (M3)
- FR7: Company admins can assign and change the role of company users (admin, member, viewer). (M3)
- FR8: Company admins can remove users from the company; removed users keep their own markup sets. (M3)
- FR9: A user can belong to at most one company. (M3)
- FR10: Viewers can view shared markup sets and change status / add comments, but cannot create or edit markups. (M4)

### 3. Platform Administration
- FR11: The platform admin can create companies and assign a company's first admin. (M3)
- FR12: The platform admin can activate, deactivate and view any user account. (M3)
- FR13: The platform admin can set the plan field (trial, pilot, standard) on companies and individual users. (M3)
- FR14: The platform admin can view activity per company and user (last active, markups saved, PDFs exported per week). (M3)
- FR15: The platform admin can look up a user's markup sets by filename and page count for support, without access to drawing content that was not uploaded. (M3)
- FR16: Company admins can view activity for their own company. (M3)

### 4. Document Viewing
- FR17: Users can open a PDF from their computer; the file is not uploaded unless server storage is turned on for that drawing. (M1)
- FR18: Users can open multiple PDFs in tabs and switch between them. (M1)
- FR19: Users can navigate pages (next, previous, first, last, go to page) and via thumbnails. (M1)
- FR20: Users can zoom, pan, fit page, fit width and rotate the view. (M1)
- FR21: Users can search text in the PDF and jump to results. (M1)
- FR22: Users can see page size, current scale and snap state in a status bar. (M1)
- FR69: The workspace uses the dark Blueprint theme by default; users can switch between Blueprint, Daylight (light) and High contrast in Settings → Appearance, and the choice is remembered. (M1)

### 5. Calibration & Measurement
- FR23: The system detects scale ratios printed on the drawing (including sheet-size qualifiers) and offers them for confirmation. (M1)
- FR24: Users can calibrate a page by two known points or by ratio, for the current page, a page range or all pages, with an optional separate Y scale and chosen precision and units. (M1)
- FR25: Users can verify a calibration against a known dimension. (M1)
- FR26: Users can measure length, polylength, area, count, angle, radius and diameter; values display in calibrated units. (M1)
- FR27: The system shows "Scale not set" instead of a value when measuring an uncalibrated page. (M1)
- FR28: Users can create an area by dynamic fill (live spreading fill bounded by drawing lines, with brush add/erase and stroke undo) and see its area. (M1)
- FR29: Users can snap points to drawing line endpoints, midpoints, intersections and edges, and constrain to horizontal/vertical/45°. (M1)
- FR30: Users can view totals of measurements in a Measurements panel. (M1)

### 6. Markup & As-Built
- FR31: Users can draw pen, highlight, typewriter (text typed directly on the page without a box), line, arrow, polyline, polygon, rectangle, ellipse, cloud, cloud+, callout, text box, note, image and dimension markups. (M1)
- FR32: Users can apply underline and strikethrough to PDF text. (M1)
- FR33: Users can select (click, lasso), move, resize, rotate, copy/paste, delete, group/ungroup, align, reorder and lock markups. (M1)
- FR34: Users can edit markup properties (colour, line width, fill, opacity, font, text, subject, layer) and copy formatting between markups. (M1)
- FR35: Users can undo and redo markup actions. (M1)
- FR36: Users can erase or white-out original drawing content non-destructively; the original stays intact until flatten/export. (M1)
- FR37: Users can place a revision stamp showing revision number, date, author and description. (M1)
- FR38: Users can insert an auto-generated legend listing the device symbols used on the page or document with their counts, which updates as symbols change. (M1)
- FR67: Users can create, rename and delete markup layers, assign markups to a layer, and show/hide or lock each layer; hidden layers are excluded from print and export unless chosen. (M1)

### 7. Tool Chest
- FR39: Users can create, rename, reorder and delete personal tool sets. (M1)
- FR40: Users can save any configured markup or symbol as a reusable tool, optionally typed as a device (group, label, description). (M1)
- FR41: Users can place tools from the Tool Chest onto the drawing; device-typed placements are counted per device type. (M1)
- FR42: Users can import a Revu `.btx` tool set file into a personal tool set. (M1)
- FR43: Users can export and import tool sets in the product's own file format. (M1)
- FR44: Company admins can publish company tool sets available to all company users; members can use but not edit them. (M3)

### 8. Markups List, Persistence & Sharing
- FR45: Users can see all markups in a list with subject, page label, comments, date, author, status, colour and layer. (M1)
- FR46: Users can sort, filter and search the Markups List, and select a row to jump to the markup. (M1)
- FR47: Users can set markup status and add comments to markups. (M4)
- FR48: Users can export the Markups List and device counts to CSV. (M4)
- FR49: The system saves markups to the user's account automatically, linked to the exact PDF file. (M1)
- FR50: When a user reopens the identical PDF, the system restores its markups; a file changed outside the app opens as a new drawing. (M1)
- FR51: Users can see a list of their markup sets (filename, pages, last modified) and open one. (M1)
- FR52: Users can share a markup set with other registered users by email, granting edit or view, and revoke shares. (M4)
- FR53: Users can turn on server PDF storage for a drawing, and remove the stored PDF from the server at any time. (M4)
- FR54: Share recipients see the PDF with markups when server storage is on; otherwise they see markups on blank pages with the original filename and page count and can open their own copy. (M4)
- FR55: The system records author, creation time, modification time and status changes for every markup. (M1/M4)

### 9. Page Editing, Print, Flatten & Export
- FR56: Users can insert pages from another PDF, insert blank pages, delete, extract, replace, rotate, reorder and crop pages; markups and calibration stay attached to their pages through these in-app edits (flattened or exported output files do not inherit the markup set). (M4)
- FR57: Users can merge multiple PDFs into one. (M4)
- FR58: Users can flatten all markups into the PDF content. (M1)
- FR59: Users can flatten only filtered or selected markups, by markup type and page range, and allow later unflatten. (M4)
- FR60: Users can export a PDF with non-flattened markups as standard PDF annotations editable in other PDF tools. (M1)
- FR61: Users can export a flattened PDF. (M1)
- FR68: Users can print the drawing with or without markups, choosing page range, fit-to-page or actual scale, and paper size. (M1)

### 10. Public Site & Discoverability
- FR62: Visitors can browse a public marketing site (features, use cases, pricing, security & privacy, FAQ). (M4)
- FR63: Visitors can read a public help centre with how-to guides. (M4)
- FR64: Search engines and AI assistants can crawl marketing and help pages, including structured data, sitemap and an llms.txt summary; app routes are excluded. (M4)
- FR65: Visitors can request access / sign up from the marketing site. (M4)
- FR66: Users can open the privacy policy and terms from the app and site. (M4)

### 11. 4541 Engine (Sprinkler Layout)
- FR70: Users can define zones on a calibrated page by dynamic fill or by drawing a polygon (any number of sides). (M2)
- FR71: Users can assign an occupancy/use (e.g. office, kitchen, storage) to each zone; the system assigns the default hazard class (ELH, OH1, OH2, OH3) and its rule figures automatically. (M2)
- FR72: Company admins can edit the default use → hazard class mapping for their company. (M3)
- FR73: Users can run automatic head placement for one zone or all zones; the system places sprinkler heads within the rule figures (max area per head, min/max spacing, min/max wall distance) and optimises their positions, for rectangular and non-rectangular zones. (M2)
- FR74: Users can set preferred wall distance and preferred head spacing within the rule limits per zone and re-run placement. (M2)
- FR75: Users can toggle a coverage overlay that draws a translucent shape around each head so uncovered areas are visible, and switch the shape between circle and square. (M2)
- FR76: Users can move, add or delete placed heads manually (e.g. to clear obstructions); placed heads behave as device symbols counted in the legend. (M2)
- FR77: The system shows, per zone, hazard class, head count, area per head and any rule figure the current layout breaks, without blocking the user. (M2)
- FR78: The system displays that layouts are advisory and the designer remains responsible for compliance, on screen and optionally in exports. (M2)
- FR79: The platform admin can maintain the default rule figures for ELH, OH1, OH2 and OH3 and the default use → hazard mapping (seeded defaults in M2; admin editing in M3). (M2/M3)
- FR80: The system records export and print events (time, user, markup set, page count — never drawing content) so activity metrics can count them. (M1)
- FR81: When a user opens a PDF whose filename matches one of their markup sets but whose content differs, the system tells them markups exist on another version and offers to open their markup set list; markups are not moved. (M1)
- FR82: When a user starts zone or measurement tools on an uncalibrated page, the system prompts them to confirm the detected scale or calibrate first. (M1)
- FR83: Users can create a personal signature (drawn on screen or uploaded image), store it in their account, and place it on drawings as a signature stamp with their name and date. (M1)
- FR84: Users can compare two PDFs (e.g. two revisions of a sheet), page by page, and see added, removed and changed content highlighted in distinct colours, with an option to cloud the differences as markups. (M4)

## Non-Functional Requirements

### Performance
- NFR1: First page of a 50 MB / A0 vector PDF is visible within 3 s on a mid-range laptop (4-core CPU, 16 GB RAM, Chrome).
- NFR2: Pan and zoom sustain ≥30 fps (target 60 fps) with 500 markups on the current page.
- NFR3: Placing, moving or editing a markup gives visual feedback within 50 ms; server save never blocks the UI.
- NFR4: Markup save round-trip ≤500 ms at p95.
- NFR5: Dynamic fill visibly spreads every animation frame and completes a typical room (≤100 m²) in ≤2 s of mouse hold.
- NFR6: 4541 engine places heads for a single zone ≤200 m² in ≤1 s and a 600 m² floor of ≤15 zones in ≤5 s, without freezing the UI (runs off the main thread).
- NFR7: Coverage overlay toggles within 100 ms.

### Accuracy
- NFR8: Measurements match the calibration exactly; values shown on screen and written to exported PDFs agree to the chosen precision.
- NFR9: 4541 engine output is verifiable: every placed layout reports coverage, spacing, wall distance and area per head computed by the same rules used to place it; automated tests prove zero uncovered sample points for each named test zone (rectangle, L-shape, triangle, diagonal wall, corridor).
- NFR10: `.btx` import reproduces ≥95% of the founder's 138 tool set items, judged per item by the criterion in Architecture Inputs A9.

### Security — Authentication & Sessions
- NFR11: Server code identifies the user only from a server-verified token (Supabase `getUser()`/verified claims via a single `getAuthUser()` helper); `getSession()` or any client-supplied user id is never trusted for authorization. Raw calls are banned by lint.
- NFR12: Authorization never reads `user_metadata` (user-editable). Roles, company and plan come from server-controlled data (`app_metadata` or database tables) only.
- NFR13: Every server action, route handler and RPC re-checks authentication and authorization itself; middleware/proxy is a convenience, never the only gate.
- NFR14: Passwords: minimum 12 characters, leaked-password check enabled, no maximum below 64; stored only by the auth provider.
- NFR15: Login, sign-up, password reset and invitation endpoints are rate-limited per IP and per account, with bot protection (CAPTCHA) on sign-up and reset.
- NFR16: Auth responses do not reveal whether an email exists (no account enumeration).
- NFR17: Sessions use httpOnly, Secure, SameSite cookies with refresh-token rotation; idle timeout 7 days, absolute 30 days; deactivation, role change or password change revokes all of that user's sessions immediately.
- NFR18: Email verification required before activation; password-reset and invitation links are single-use, expire (≤1 h reset, ≤7 days invite) and are bound to the target email.
- NFR19: Redirect targets after login, reset and invite are restricted to an allowlist (no open redirect).
- (Deferred to Growth: MFA/TOTP — decided 2026-10-16.)

### Security — Data Access
- NFR20: Row-level security is enabled with default-deny on every table; a CI check fails the build if any table lacks RLS or policies. Access checks use shared helper functions, not inline JWT parsing.
- NFR21: Every request that takes an id (markup set, tool set, share, company, user) verifies ownership or membership server-side (no IDOR); ids are UUIDs.
- NFR22: `SECURITY DEFINER` functions set a fixed `search_path`, verify the caller inside the function, and have EXECUTE revoked from `anon`/`public`.
- NFR23: The service-role key and other secrets exist only in server environment variables, never in client bundles or `NEXT_PUBLIC_*`; secret scanning runs on every push and `.env*` files are never committed.
- NFR24: All server inputs are validated with schemas that whitelist fields; users cannot set protected fields (role, company_id, plan, owner, activated) through any endpoint (no mass assignment).
- NFR25: Storage buckets for PDFs are private; access only via short-lived signed URLs (≤10 min) issued after an authorization check.
- NFR26: PDFs are never transmitted to the server unless the user has enabled server storage for that drawing (verified by an automated test); deleting a stored PDF removes it from storage immediately and from backups on their next rotation.

### Security — Application & Files
- NFR27: User text (markup text, comments, names, tool labels) is rendered as text, never as HTML; no `dangerouslySetInnerHTML` on user content.
- NFR28: Strict Content-Security-Policy with nonces; HSTS, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy and Permissions-Policy headers on every response.
- NFR29: State-changing requests are protected against CSRF (origin checks on route handlers; framework protection on server actions).
- NFR30: PDF parsing runs in a worker with script evaluation disabled; PDF JavaScript and embedded actions are never executed.
- NFR31: `.btx` and tool set import enforces file-size and decompressed-size limits (zip-bomb safe), disables XML external entities, and sanitises any SVG/appearance content before rendering.
- NFR32: Error responses never expose stack traces, SQL or internal ids; logs never contain passwords, tokens or drawing content.
- NFR33: Dependencies are pinned and audited in CI; high/critical vulnerabilities block release.

### Security — Governance
- NFR34: Platform-admin and company-admin actions (activation, role/plan changes, removals, share revocations, rule-figure edits) are audit-logged with actor, target and time.
- NFR35: All traffic over TLS 1.2+; data encrypted at rest; all server data hosted in an Australian or NZ region.
- NFR36: A dedicated security review pass (separate from code review) is completed before the first pilot company and before each milestone release, covering the checklist above; findings rated High must be fixed before release.

### Reliability & Data Safety
- NFR37: No markup is lost on refresh, crash or network drop: edits are queued locally and synced when the connection returns.
- NFR38: Service availability ≥99.5% monthly (excluding announced maintenance).
- NFR39: Daily database backups with point-in-time recovery of at least 7 days.

### Scalability
- NFR40: MVP supports 50 companies / 500 users and 1 million markups without architectural change; per-page markup queries stay within NFR4.

### Compatibility
- NFR41: Exported PDFs open without errors in Adobe Acrobat, Bluebeam Revu and Chrome's PDF viewer; non-flattened markups remain editable in Acrobat and Revu.
- NFR42: Supported browsers: latest 2 versions of Chrome and Edge (full), latest Firefox and Safari (best effort); minimum viewport 1280×720.

### Accessibility
- NFR43: Admin screens and marketing site meet WCAG 2.1 AA; workspace toolbars, panels and dialogs are keyboard reachable with visible focus.

### Discoverability
- NFR44: Marketing pages meet Core Web Vitals (LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms) and validate in Google's Rich Results Test.

### Maintainability & Observability
- NFR45: Geometry, scale, fill and 4541 engine logic live in framework-free modules with unit tests that run the shipped code; every fixed bug adds a named test.
- NFR46: Front-end and server errors are reported to an error-tracking service from the first deployed build.
- NFR47: CI checks schema drift, generated-type drift, lint, type-check and tests on every push.

## Architecture Inputs (resolve in the architecture document)

Raised in the final multi-agent PRD review. Proposed defaults are binding
unless the architecture document records a better decision.

- **A1 Fingerprint:** exact identity = SHA-256 of the file bytes (computed in a
  worker, parallel to rendering); pdf.js document fingerprint stored as a
  secondary attribute for FR81 hints only.
- **A2 Lineage of in-app edits:** page edits (FR56/FR57) create a new file
  version linked to the same markup set; markups and calibration are bound to
  stable page ids, not page indexes, and are transformed through rotate/crop.
  Flatten/export outputs are deliverables with no markup set.
- **A3 Existing PDF annotations:** annotations already in an opened PDF are
  displayed as part of the page (read-only) and not imported in MVP.
- **A4 Sync & conflicts (NFR37 × FR52):** per-markup version, field-level
  last-write-wins, deletes as tombstones that win, status/comments as an
  append-only log; undo of a synced change is a compensating operation.
- **A5 Export mapping (FR60/NFR41):** a table assigning every markup type
  (incl. cloud+, dimension, calibrated measurements, dynamic fill, white-out,
  device stamps, groups, layers/OCG) to native annotation, appearance-only, or
  forced flatten; verified by a manual Acrobat/Revu checklist on a sample set.
- **A6 Permissions:** effective access = min(company role, share grant).
- **A7 Rule figures:** each zone layout stores the rule-figure version used;
  a fixture table of ELH/OH1/OH2/OH3 figures (founder-verified) exists before
  M2 starts and is the test oracle.
- **A8 4541 objective & oracle:** objective = minimise head count, then
  minimise spacing deviation from preferences; coverage sampled on a ≤100 mm
  grid including boundary points; the oracle is an independent module (no imports from the placer) per `docs/4541-placement-design.md` §4, not the prototype `audit()`;
  named test zones: rectangle, L-shape, triangle, diagonal wall, corridor.
- **A9 .btx fidelity criterion:** per item — parses, renders within a pixel-
  diff threshold of a reference PNG exported from Revu, and can be placed as a
  stamp/device.
- **A10 Performance definitions:** NFR1 = first low-resolution frame; reference
  hardware shared by NFR1/NFR6; "no UI freeze" = no main-thread task >50 ms;
  fixture PDFs named for "A0 50 MB" and "typical room"; server-PDF recipient
  path excluded from NFR1.
- **A11 Dynamic fill output** stored as vector polygons (not raster masks).
- **A12 Prototype port** is a refactor (globals → modules with injected
  dependencies, render-pixel → PDF user-space coordinates), not a copy.
- **A13 Spike order:** `.btx` parse+render → irregular placement + objective →
  A0 render + 500-markup fps → annotation export round-trip in Revu.
- **A14 UX design must define first:** first-run flow (open → calibrate →
  first stamp), save/sync/fingerprint status model, 4541 panel information
  structure with a defaults-only path to "Place heads", and empty / loading /
  error / offline / pending-activation / image-only-PDF / partial-import states.
- **A15 Story splitting:** FR31, FR33, FR42, FR56 and FR73 are epic-sized and
  must be split per tool / per step during epic breakdown.
- **A16 M2 gate baseline:** the founder times manual head placement on the same
  3 drawings before running the engine.

## Appendix: Decision Log

Decisions confirmed by the founder during PRD discovery (2026-10-15/16).

| Topic | Decision |
|---|---|
| Product | Commercial SaaS for multiple fire protection companies; working name plan-markup |
| Language | Everything in English (UI, code, comments, logs, errors, commits, docs) |
| Tenancy | Individual users by default; optional grouping into companies; roles admin / member / viewer granted at company level; founder is platform admin |
| Billing | Deferred; plan field set manually; sign-ups pending until activated |
| Drawings | Stay on the user's machine by default; optional per-drawing server PDF storage |
| Persistence | Markups restored only for the identical PDF; no fuzzy match, relink or revision carry-over |
| Sharing | By email to any registered user (inside or outside the company), edit or view |
| As-built | Both drawing over the original and erasing/whiting-out original content (distinct from flatten) |
| Tool Chest | Own file format; Revu `.btx` is a one-time import |
| 4541 engine | MVP core (M2): zones, use → hazard (ELH, OH1–OH3), automatic placement for any zone shape, tunable spacing/wall distance, coverage overlay (circle/square); obstructions handled manually; algorithm designed with Claude Fable |
| Rule figures | Shipped as defaults, confirmed once by the founder against a licensed NZS 4541 copy; layouts advisory |
| Prior art | Port dynamic fill, scale detection, vector snap, geometry, export, legend from the founder's prototype (`C:\bluebeam\tool`); its placement algorithm is replaced |
| Ownership | Markup sets stay owned by their creator; company ownership of departed members' work is not handled in MVP |
| In-app page edits | Markups follow their pages; flatten/export outputs do not inherit markups |
| External reviewers | Share-invited sign-ups auto-activated, limited to shared items |
| Launch | M4 gate; M1 scope kept as is (no split) |
| Signature | Signature image stamp in M1 (FR83); certificate-based digital signatures deferred to Growth |
| Compare | Document compare included in MVP at M4 (FR84) |
| M1 gate | As-built and markup work only for 5 days without Revu |
| Out of scope | DWG/DXF, tablet mode, full/customisable keyboard shortcuts (basic set in MVP), MFA (Growth), obstruction library / obstruction-aware placement (Growth), ceiling-tile snapping for general markups |
| MVP cuts | Arc, volume, perimeter, hyperlink, file attachment, spell check, 3D, split view |
| MVP adds | Auto legend, revision stamp, markup layers, print, dark theme default |
| SEO | Public marketing site + help centre optimised for Google and AI assistants |
| Security | Login hardening and AI-common-mistake checklist (NFR11–NFR36); separate security review before pilots |
