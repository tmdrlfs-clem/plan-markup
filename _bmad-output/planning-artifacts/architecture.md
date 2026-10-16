---
stepsCompleted:
  - step-01-init
  - step-02-context
  - step-03-starter
  - step-04-decisions
  - step-05-patterns
  - step-06-structure
  - step-07-validation
  - step-08-complete
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - docs/feature-inventory.md
  - docs/prior-art-sprinkler-drafter.md
  - docs/4541-placement-design.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-10-16'
project_name: 'plan-markup'
user_name: 'Cchoi'
date: '2026-10-16'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 84 FRs in 11 capability areas.

| Area | FRs | Architectural meaning |
|---|---|---|
| Accounts, companies, platform admin | FR1–16, FR80 | Multi-tenant auth, RBAC, admin console, activity events |
| Document viewing | FR17–22, FR69 | Client-side PDF engine (worker), tabs, virtualised pages |
| Calibration & measurement | FR23–30, FR82 | Pure geometry core, per-page calibration, vector snap index |
| Markup & as-built | FR31–38, FR67, FR83 | Canvas scene graph + editor store, undo/redo, layers |
| Tool Chest | FR39–44 | Typed device model, `.btx` importer (untrusted file parsing), own format |
| Markups list, persistence, sharing | FR45–55, FR81 | Server markup store keyed to file hash, op sync, shares, optional PDF storage |
| Page editing, print, flatten, export | FR56–61, FR68, FR84 | Client-side PDF writing (pdf-lib), page-id lineage, compare engine |
| Public site | FR62–66 | Separate statically rendered marketing/help surface |
| 4541 engine | FR70–79 | Zone model, rule tables with versions, placement optimiser in a worker |

**Non-Functional Requirements that drive architecture:**
- Performance (NFR1–7): A0 first frame ≤3 s, ≥30 fps with 500 markups, 4541 ≤5 s/floor → rendering, hashing, fill and placement off the main thread; canvas layering; spatial indexes.
- Accuracy (NFR8–10): one canonical coordinate space (PDF user space), deterministic geometry, oracle-tested placement.
- Security (NFR11–36): server-verified auth helper, RLS default-deny + CI check, no PDF upload unless opted in, hardened file parsing, strict CSP.
- Reliability (NFR37–39): offline-tolerant op queue with defined conflict rules (A4).
- Compatibility (NFR41): standards-compliant PDF annotation export (A5).

**Scale & Complexity:**
- Primary domain: full-stack web — heavy client (canvas/PDF/geometry) + thin server (auth, RLS data, storage).
- Complexity level: high.
- Estimated architectural components: ~12 (auth/tenancy, admin, marketing site, PDF engine, canvas editor, geometry core, 4541 engine, tool chest/importer, markup store + sync, sharing/storage, export/compare, observability/CI).

### Technical Constraints & Dependencies

- Stack (founder's proven stack): Next.js 16 (App Router, `src/proxy.ts` as middleware), React 19, Tailwind v4 tokens, Supabase (Postgres + RLS, Auth, Storage) in AU region, Zod v4.
- PDF: pdf.js (render/text, worker, eval disabled), pdf-lib (write/flatten/page ops/annotations).
- Drawings never uploaded by default → most heavy work must run in the browser.
- Prototype modules (`C:\bluebeam\tool`) are refactored, not copied (A12).
- Known pitfalls to design around: never override JWT `role` claim; `getUser()` lacks custom claims → `getAuthUser()` wrapper; SECURITY DEFINER RPCs re-check ownership; explicit FK names in PostgREST embeds; Zod v4 UUID/datetime quirks; stale JWT after auth-hook changes.
- Solo founder + AI-assisted development → boring tech, strong module boundaries, tests that run shipped code.
- Flatten: proven approach in prototype `exportPdf()` (pdf-lib draws onto original pages). Unflatten = embed markup data in the flattened PDF, restorable in our app only. White-out = visual cover; true content removal deferred (founder-confirmed 2026-10-16: MVP = white-out + flatten).

### Cross-Cutting Concerns Identified

1. Identity & tenancy (auth helper, RLS helpers, effective permission = min(role, grant)).
2. Coordinate model & page identity (PDF user space, stable page ids, per-page calibration).
3. File identity & lineage (SHA-256, in-app edit lineage, FR81 hints).
4. Sync & conflict model (op log, versions, tombstones, offline queue).
5. Worker architecture (render, hash, fill, 4541, compare off main thread).
6. Untrusted input handling (PDF, `.btx`, images, user text).
7. Export fidelity (annotation mapping table, flatten).
8. Observability & audit (error tracking from first deploy, admin audit log, activity events).
9. Testing strategy (pure core unit tests, RLS matrix, placement oracle, export checklist).
10. Theming & design tokens (three themes: Blueprint default, Daylight, High contrast; near-sharp).

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application: a heavy client (PDF rendering, canvas editor, geometry, 4541 engine in Web Workers) on a thin server (Supabase Auth, Postgres + RLS, Storage) behind Next.js.

Versions verified with `npm view` on 2026-10-16:

| Package | Version | Note |
|---|---|---|
| next | 16.4.2 | App Router, Turbopack default, `src/proxy.ts` |
| react | 19.3.1 | |
| typescript | 7.0.2 | Native (Go) compiler; pin 5.x/6.x if any tool in the chain is not yet compatible |
| tailwindcss | 4.3.3 | CSS-first tokens |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7 | Cookie-based auth |
| zod | 4.6.7 | |
| pdfjs-dist | 6.4.299 | Render + text + vector extraction, worker, `isEvalSupported: false` |
| pdf-lib | 1.17.1 | **Unmaintained since 2022** |
| @cantoo/pdf-lib | 2.11.1 | Maintained fork (updated 2026-09); same API; candidate replacement — decided in step 4 |
| vitest | 5.0.5 | Unit tests for pure core |
| @playwright/test | 1.64.1 | E2E + canvas smoke |
| zustand | 5.0.15 | Editor store candidate — decided in step 4 |
| radix-ui | 1.8.1 | Headless accessible UI primitives (UX spec) |
| lucide-react | 1.58.0 | Chrome icons (UX spec) |

### Starter Options Considered

1. **`create-next-app@latest` (plain)** — TS, Tailwind v4, ESLint, App Router, `src/`, Turbopack. Minimal opinions; we add Supabase with the founder's proven patterns (`getAuthUser()`, JWT helpers, RLS CI check) from Fire Impairment Manager.
2. **`create-next-app --example with-supabase`** — adds `@supabase/ssr` wiring, shadcn/ui and a password auth block. Saves an hour of wiring but brings shadcn defaults (large rounded, blurred shadows) that conflict with near-sharp tokens, and its auth sample uses `getUser()` patterns we already replace.
3. **Community starters (T3, supa-next-starter, etc.)** — extra layers (tRPC, Prisma, TanStack Query, Jest) we do not need; maintenance varies.

### Selected Starter: plain `create-next-app`

**Rationale:** The hard parts of this product (PDF engine, canvas, geometry, 4541) are not covered by any starter. The parts starters do cover (auth, styling) are exactly where the founder has battle-tested patterns that differ from starter defaults. Least to undo wins.

**Initialization Command:**

```bash
npx create-next-app@latest plan-markup-app --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-npm
# app lives at the plan-markup/ repo root: scaffold into plan-markup-app/, then move its files up to the root (root already holds docs/, _bmad-output/, .claude/)
```

Then: `@supabase/supabase-js @supabase/ssr zod pdfjs-dist` (+ PDF writer chosen in step 4), dev: `vitest @playwright/test`, `supabase init` for local Docker stack.

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript strict, Node ≥ 20.9, React 19 server/client components.
- **Styling:** Tailwind v4 (CSS `@theme` tokens) — three themes under `[data-theme]` (Blueprint default, Daylight, High contrast; admin/marketing use Daylight), near-sharp radii. UI primitives `radix-ui` 1.8.1, icons `lucide-react` 1.58.0 (chosen in the UX spec).
- **Build Tooling:** Turbopack dev + build; workers bundled via `new Worker(new URL(..., import.meta.url))`.
- **Testing:** none from starter — we add Vitest (pure core, RLS matrix via local Supabase) and Playwright.
- **Code Organization:** `src/app` routes; framework-free domain code (geometry, 4541, btx importer, annotation mapping) in `src/core/*` with no React/Next imports so it runs in workers and tests unchanged.
- **Development Experience:** HMR, ESLint flat config, local Supabase via Docker.

**Note:** Project initialization with this command is the first implementation story.

### Sample Drawings Received (test fixtures)

`C:\bluebeam\A1721-…-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf`, `A2121-…-LEVEL-21-…`:
- 1 page each, A1 (841×594 mm), fully vector: ~169k / ~178k path ops, 3 images, ~800 text items.
- Title block scale "As indicated" → scale must come from viewport labels/scale bars or manual calibration, not the title block.
- Reflected ceiling plans with ceiling legend and "SPRINKLERS. REFER TO … FIRE" note → realistic 4541 inputs.
- Performance implication: ~180k ops per sheet confirms NFR1 (≤3 s first frame) needs worker rendering + tiled/cached rasters, and the vector snap index must be built off-thread and spatially indexed.

## Core Architectural Decisions

### Decision Priority Analysis

**Already decided (PRD Architecture Inputs A1–A12, step 2/3):** Next.js 16 + Supabase AU, pdf.js render, SHA-256 file identity (A1), page-id lineage (A2), existing annotations read-only (A3), field-level LWW + tombstones + append-only status log (A4), export mapping table (A5), min(role, grant) (A6), versioned rule figures (A7), 4541 objective + oracle (A8), `.btx` fidelity criterion (A9), perf definitions (A10).

**Critical (block implementation):** PDF writer library, canvas rendering approach, markup data model, sync transport + offline queue, auth/RLS pattern.

**Important (shape architecture):** editor state store, worker topology, spatial index, hosting/regions, observability.

**Deferred (post-MVP):** true content removal (redaction), real-time co-editing cursors, billing, PostGIS, native desktop wrapper.

### Data Architecture

- **Database:** Supabase Postgres (AU, Sydney). Local dev via Supabase CLI (`supabase` 2.121.0) + Docker.
- **Core tables (shape, not final DDL):**
  - `companies`, `profiles`, `company_members(role)`.
  - `drawings` (markup set): owner, company, title, `storage_enabled`.
  - `drawing_files`: drawing_id, `sha256` (unique per drawing), pdfjs fingerprint (hint only), page_count, filename, parent_file_id (A2 lineage), storage_path (null unless FR53 on).
  - `pages`: stable `page_id` (uuid), drawing_file_id, index, rotation, crop box, size; `calibrations` per page_id.
  - `markups`: id (client-generated uuid v7), drawing_id, page_id, `type`, `geometry jsonb` (PDF user space), `style jsonb`, `props jsonb` (subject, layer, device ref, measurement values), `version int`, `field_versions jsonb`, author, timestamps, `deleted_at` (tombstone).
  - `markup_events`: append-only status/comment log (A4).
  - `tool_sets`, `tools` (typed device model, imported from `.btx` or native).
  - `zones`, `zone_layouts` (rule_figure_version, inputs, result, report) for 4541.
  - `rule_figures(version, hazard_class, …)`, `use_hazard_map(company_id nullable)`.
  - `shares(drawing_id, grantee, access)`, `audit_log`, `activity_events`.
- **Geometry storage:** `jsonb` in PDF user-space points, not PostGIS — spatial queries happen client-side; server only filters by drawing/page. PostGIS deferred.
- **Validation:** Zod v4 schemas in `src/core/schema/*` shared by client, worker, server actions; one schema per markup type (discriminated union on `type`). UUIDs validated with the permissive pattern (pitfall: Zod v4 `uuid()` strictness).
- **Migrations:** Supabase SQL migrations in repo, schema-drift check + RLS smoke tests in CI from day 1.
- **Client caching:** IndexedDB (`idb` 8.0.4) holds the op queue, last-synced markups per drawing, and rendered tile cache keyed by sha256 + page + zoom bucket.

### Authentication & Security

- **Auth:** Supabase Auth email/password (+ magic link) via `@supabase/ssr` cookies; `src/proxy.ts` refreshes session.
- **Server identity:** `getAuthUser()` wrapper (never raw `getUser()` for claims); custom claims under a namespaced key, never overriding `role`.
- **Authorization:** RLS default-deny on every table; SQL helper functions (`is_company_member`, `effective_access(drawing_id)` = min(role, grant)); SECURITY DEFINER RPCs re-check ownership.
- **Platform admin:** separate claim + admin route group; every admin write goes to `audit_log`.
- **Files:** PDFs parsed client-side only; Storage bucket private, per-drawing paths, signed URLs; `.btx` parsed in a worker with size/depth limits, zlib bomb guard.
- **Headers:** strict CSP (pdf.js with `isEvalSupported: false`, worker-src self/blob), HSTS, frame-ancestors none.
- **Rate limiting:** Supabase Auth built-ins + per-user limits on RPCs that write ops (Postgres-side counter).

### API & Communication Patterns

- **Reads:** supabase-js from the client under RLS (PostgREST), explicit FK names in embeds.
- **Writes:** markup ops batched (debounced ~300 ms) to one RPC `apply_markup_ops(drawing_id, ops[])` that applies field-level LWW using `field_versions`, writes tombstones, returns server versions. Admin/company actions via Next.js server actions.
- **Real-time:** Supabase Realtime on `markups` for open shared drawings only; others rely on op RPC responses.
- **Errors:** typed result objects `{ ok, data } | { ok:false, code, message }` across RPC/server actions; user-facing messages never leak SQL.
- **Offline:** op queue in IndexedDB, replayed in order on reconnect; UI never waits on server (NFR3).

### Frontend Architecture

- **Rendering:** custom Canvas2D scene graph. Layer stack: (1) PDF raster tiles from pdf.js in a worker → `ImageBitmap`, (2) static markups canvas, (3) active/selection canvas, (4) DOM overlays (text edit, handles' tooltips).
- **Editor store:** `zustand` 5.0.15 vanilla store outside React (tools, selection, undo stack as command objects); the undo history is serialised per browser tab to `sessionStorage` so it survives a reload until the tab closes (UX-DR36); React subscribes with selectors. Server state (lists, admin) via plain fetch + React cache, no TanStack Query.
- **Workers:** `render.worker` (pdf.js), `engine.worker` (hash, vector extraction, snap index build, dynamic fill, 4541), `export.worker` (PDF writing with `@cantoo/pdf-lib`). Comlink-style typed messages.
- **Spatial index:** `flatbush` 4.6.2 (static, fast) for vector snap segments per page; `rbush` 4.0.1 (dynamic) for markup hit-testing.
- **Routing:** route groups `(marketing)` static, `(workspace)` client-heavy, `(admin)`.
- **Bundle:** workspace code dynamically imported; marketing pages ship no canvas code.

### 4541 Engine

Full design: `docs/4541-placement-design.md`.

- **Placement:** frame search (≤3 grid angles) × bay decomposition at reflex corners × row sweep with an exact 1-D DP per row. Lexicographic objective (A8): head count, then deviation from preferred spacing/wall distance, then cross-row and ceiling-tile alignment. All rules are hard constraints, no repair pass; infeasible zones return a located error.
- **Patterns:** rectangular (default) or staggered per zone (user option).
- **Geometry:** columns are holes that block spray and need `Wmin` clearance, but `Wmax` does not apply to column faces (founder 2026-10-17); zones touching without a wall are checked across the shared edge; polygon ops via Clipper2 in integer mm.
- **Oracle:** independent module (lint + CI forbid imports from the placer), own 100 mm sample grid on the original polygon; checks coverage (Rc), wall distance, min/max spacing; area per head = warning. Same oracle feeds the FR77 report and NFR9 tests, plus mutation tests with broken layouts.
- **Rule figures:** versioned JSON `nzs4541` v1 (`verified: true`) mirrored to the DB (A7); founder-confirmed 2026-10-16 — ELH: Amax 21 m², Smax 4.6 m, Wmax 2.3 m; OH1–3: Amax 12 m², Smax 4.0 m, Wmax 2.0 m; all: Smin 1.8 m, Wmin 50 mm. This satisfies A7's pre-M2 fixture requirement.
- **Ceiling grid:** user-declared grid, tile-centre stops, `preferred` by default.
- **Post-MVP obstruction library (decided 2026-10-17):** height-aware obstructions with baffled coverage are Growth scope (design §9). M2 must keep the §9.5 hooks: one `Barrier[]` input to placer and oracle, per-head coverage polygons in the overlay, ruleset schema with extra named tables and per-table `verified` flags.
- **Implementation ownership:** the placement algorithm and its oracle (`src/core/sprinkler/*`) are implemented by a Fable-model agent from `docs/4541-placement-design.md` (founder decision 2026-10-16); other stories follow the normal dev flow.
- **Performance:** ~0.1 s per zone, 1–2 s per 600 m² floor in `engine.worker`; operation-count budgets for determinism (NFR6).

### Infrastructure & Deployment

- **Hosting:** Vercel (functions region `syd1`) + Supabase cloud (ap-southeast-2).
- **CI:** GitHub Actions — typecheck, lint, Vitest (core + RLS matrix on local Supabase), Playwright smoke, schema-drift.
- **Environments:** local (Docker Supabase), preview (Vercel preview + Supabase branch or staging project), production.
- **Observability:** Sentry (`@sentry/nextjs` 11.8.0) from first deploy, incl. worker errors; `activity_events` table for product metrics.
- **Scaling:** server load is light (rows only); main scaling risk is client memory on huge PDFs → tile cache eviction budget.

### Founder Decisions (2026-10-16)

1. **PDF writer:** `@cantoo/pdf-lib` 2.11.1 (maintained fork, same API). Original `pdf-lib` is not used.
2. **Markup rendering:** custom Canvas2D scene graph (prototype approach). No Konva/PixiJS.
3. **Real-time:** Supabase Realtime subscription on `markups` only for drawings that are shared and open; single-user drawings do not subscribe.
4. **Hosting:** Vercel (`syd1`) + Supabase cloud (ap-southeast-2).

### Decision Impact Analysis

**Implementation sequence:** scaffold → auth/RLS helpers + CI → schema (drawings/files/pages/markups) → pdf.js worker + tiles → canvas editor + store → op sync + IndexedDB queue → calibration/measure → export (pdf writer) → tool chest/`.btx` → 4541 engine → sharing/storage/realtime → admin → marketing.

**Cross-component dependencies:** page_id lineage underpins markups, calibration and export; Zod schemas shared across client/worker/server; worker topology shared by render, fill, snap and 4541; A4 conflict rules shape both the RPC and undo (compensating ops).

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical conflict points identified:** 14 — table/column naming, JSON casing across the DB boundary, coordinate units, ids, file naming, test location, core-vs-UI boundary, worker messages, store actions/undo, op format, result/error shape, logging, loading/empty states, time formats.

### Naming Patterns

**Database (Postgres):**
- Tables plural `snake_case`: `drawings`, `drawing_files`, `markup_events`.
- Columns `snake_case`; FKs `<singular>_id` (`drawing_id`); timestamps `created_at`, `updated_at`, `deleted_at` (tombstone = `deleted_at`, never an `active` flag).
- Indexes `idx_<table>_<cols>`; uniques `uq_<table>_<cols>`; FKs named `fk_<table>_<ref>` so PostgREST embeds can name them explicitly.
- Enums as `text` + CHECK (easier migrations than Postgres enums).
- RLS helpers `fn_` prefix in schema `app`: `app.fn_is_company_member()`, `app.fn_effective_access(drawing_id)`. RPCs verb-first: `apply_markup_ops`, `create_share`.
- Policies named `<table>_<action>_<who>`: `markups_select_member`.

**Code (TypeScript):**
- Files `kebab-case.ts(x)`; React components `PascalCase` exports inside `kebab-case.tsx` (`markup-list.tsx` → `MarkupList`).
- Functions/vars `camelCase`; types/interfaces `PascalCase`, no `I` prefix; constants `SCREAMING_SNAKE`.
- Zod schemas `<Name>Schema` with `type <Name> = z.infer<typeof <Name>Schema>`.
- Units in names when ambiguous: `lengthPt`, `lengthMm`, `areaM2`, `angleRad`.
- Booleans `is/has/can` prefix.

**Routes:** App Router segments `kebab-case`, dynamic params `[drawingId]` (camelCase). Route handlers only where server actions do not fit (webhooks, file signing): `/api/<resource>/<action>`.

### Structure Patterns

- `src/core/<domain>/` — framework-free (no React, Next, DOM, Supabase imports; enforced by ESLint `no-restricted-imports`). Domains: `geometry`, `pdf`, `markup`, `measure`, `fill`, `snap`, `sprinkler`, `btx`, `export`, `sync`, `schema`.
- `src/workers/` — thin worker entry files that call `src/core/*`.
- `src/features/<feature>/` — UI + hooks + server actions per feature (`viewer`, `editor`, `tool-chest`, `markups-list`, `sharing`, `admin`, …).
- `src/components/ui/` — shared primitives (near-sharp tokens). `src/lib/` — app-level adapters (supabase clients, `getAuthUser`, sentry).
- Tests co-located: `foo.ts` + `foo.test.ts`. RLS tests in `supabase/tests/`. E2E in `e2e/`. Fixtures (sample PDFs, `.btx`, zones) in `fixtures/` — real client drawings are git-ignored unless the founder approves.
- `src/core/sprinkler/oracle/` may not import `src/core/sprinkler/placer/` (lint + CI test).

### Format Patterns

- **Casing boundary:** DB and RPC payloads `snake_case`; TypeScript `camelCase`. Conversion happens only in `src/lib/db/*` mappers — nowhere else.
- **Ids:** UUID v7 generated client-side for markups/ops (offline-safe); server-generated UUIDs elsewhere.
- **Coordinates:** stored and computed in PDF user-space points (1/72 in), origin as PDF (bottom-left) in storage; screen transforms only in the viewer. mm/m appear only at display and in rule tables (rule figures in metres, converted via calibration).
- **Time:** `timestamptz` in DB, ISO-8601 UTC strings in JSON, displayed in the user's locale (NZ default). `datetime-local` inputs converted with `toISOString()` before validation.
- **Result shape** (server actions, RPC wrappers, worker replies): `{ ok: true, data } | { ok: false, code, message }`; `code` is a stable `SCREAMING_SNAKE` string (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_INPUT`, `RATE_LIMITED`, `INTERNAL`).
- **Nulls:** absent optional fields are omitted in TS objects, `null` in DB; never empty string as "none".

### Communication Patterns

- **Markup ops:** `{ opId, markupId, kind: 'create'|'update'|'delete', fields?, baseVersion, clientTs }`; `update` carries only changed fields. The server returns `{ markupId, version, fieldVersions }` per op.
- **Worker messages:** `{ type: '<domain>.<verb>', reqId, payload }` → `{ type: 'result'|'progress'|'error', reqId, … }`; e.g. `sprinkler.place`, `fill.step`, `snap.buildIndex`. Transfer `ArrayBuffer`s, never structured-clone large arrays.
- **Store (zustand vanilla):** one editor store, slices `doc`, `view`, `tools`, `selection`, `history`. Immutable updates. Every user-visible mutation is a command object `{ do(), undo(), label }` pushed to `history` and emitted as ops — no direct `setState` for document data from components.
- **Activity events:** `<domain>.<past_verb>` (`drawing.opened`, `markup.exported`, `sprinkler.placed`), payload without drawing content.
- **Realtime:** channel `drawing:<drawingId>`; incoming changes go through the same op-apply path as local ones.

### Process Patterns

- **Errors:** core functions throw only on programmer error; expected failures return result objects. UI shows toasts for recoverable errors and an error boundary per route group. All unexpected errors → Sentry with drawing id, never drawing content or file names of client drawings.
- **Logging:** no `console.log` in committed code (lint); `logger.{debug,info,warn,error}` wrapper; levels gated by env.
- **Auth:** every server action starts with `const user = await getAuthUser()`; privilege checks via SQL helpers, not ad hoc in TS.
- **Validation:** Zod at every trust boundary — server action input, RPC input (DB CHECKs as a second layer), worker input, file parsers (`.btx`, imported JSON).
- **Loading:** local state per component (`status: 'idle'|'loading'|'ready'|'error'`); skeletons for lists; the canvas never blocks on the network; save status shown in the status bar with the six states of UX spec flow F2 (`Saved`, `Saving…`, `Offline — n changes waiting`, `Not synced — Retry`, `Local only — Sign in to save`, conflict toast).
- **Retry:** op sync retries with exponential backoff (cap 30 s) and resumes on `online`; no retries for 4xx-type codes except `CONFLICT` (re-base and resend).

### Enforcement Guidelines

**All AI agents MUST:**
- Keep `src/core/*` framework-free and deterministic; add/extend unit tests that import the shipped module.
- Store geometry in PDF points; never persist screen pixels or mm.
- Go through `getAuthUser()`, RLS helpers and the `src/lib/db` mappers — no raw table access from components.
- Route every document mutation through a command → op.
- Write all product text, code, comments, logs, errors and commits in English.
- Follow near-sharp UI tokens (2–4 px radius, hard offset shadows, ring-2 focus); no blur shadows or large radii.

**Enforcement:** ESLint rules (restricted imports, no-console), `tsc --noEmit`, CI tests (core, RLS matrix, oracle independence, schema drift), PR review via `bmad-code-review`. Pattern changes are edited here first, then applied.

### Pattern Examples

**Good:** `apply_markup_ops` RPC called from `src/lib/db/markups.ts`, which maps `field_versions` → `fieldVersions`; `distanceMm = ptToMm(lengthPt, calibration)` at render time only.

**Anti-patterns:** a component calling `supabase.from('markups').update(...)`; storing `{ x: 512, y: 300 }` canvas pixels; `src/core/fill` importing `react`; returning `throw new Error('not found')` from a server action; an `active boolean` soft-delete column.

## Project Structure & Boundaries

### Complete Project Directory Structure

The app lives at the repo root of `plan-markup/` (planning artifacts stay in `_bmad-output/`, design docs in `docs/`).

```
plan-markup/
├── README.md
├── package.json
├── next.config.ts                # CSP/security headers, worker bundling
├── tsconfig.json
├── eslint.config.mjs             # restricted imports (core purity, oracle independence), no-console
├── vitest.config.ts
├── playwright.config.ts
├── .env.example                  # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SENTRY_DSN …
├── .gitignore                    # .env*.local, fixtures/private/
├── .github/workflows/
│   ├── ci.yml                    # typecheck, lint, vitest, playwright smoke
│   └── db.yml                    # supabase start → migrations → schema-drift → RLS tests
├── docs/
│   ├── feature-inventory.md
│   ├── prior-art-sprinkler-drafter.md
│   ├── 4541-placement-design.md
│   └── export-mapping.md         # A5 table + Acrobat/Revu checklist
├── supabase/
│   ├── config.toml
│   ├── migrations/               # YYYYMMDDHHMMSS_<desc>.sql
│   ├── seed.sql                  # dev users, nzs4541 v1 rule figures, use→hazard map
│   └── tests/                    # RLS matrix (pgTAP or vitest + service/anon clients)
├── fixtures/
│   ├── pdf/                      # small synthetic PDFs (committed)
│   ├── btx/                      # synthetic .btx samples
│   ├── zones/                    # NFR9 named zones (JSON)
│   └── private/                  # founder RCPs, real .btx — git-ignored
├── e2e/
│   ├── open-and-markup.spec.ts
│   ├── calibrate-measure.spec.ts
│   ├── export.spec.ts
│   └── sprinkler.spec.ts
├── public/
│   ├── llms.txt
│   └── robots.txt
└── src/
    ├── proxy.ts                  # session refresh, route guards (Next 16 middleware)
    ├── app/
    │   ├── layout.tsx            # root: fonts, theme tokens
    │   ├── globals.css           # Tailwind v4 @theme tokens (near-sharp, dark/light)
    │   ├── (marketing)/          # static: page.tsx, features/, pricing/, security/, faq/, help/[slug]/, sitemap.ts
    │   ├── (auth)/               # login/, signup/, reset-password/, auth/callback/route.ts
    │   ├── (workspace)/
    │   │   ├── layout.tsx        # dark workspace shell
    │   │   ├── drawings/page.tsx             # markup set list (FR51)
    │   │   ├── viewer/page.tsx               # open local PDF → editor
    │   │   ├── d/[drawingId]/page.tsx        # open saved/shared markup set
    │   │   ├── tool-sets/page.tsx
    │   │   └── settings/                     # profile, signature, company (admin)
    │   ├── (admin)/
    │   │   ├── layout.tsx        # light admin shell, platform-admin guard
    │   │   └── admin/{users,companies,activity,audit,rules}/page.tsx
    │   └── api/
    │       ├── storage/sign/route.ts         # signed upload/download URLs (FR53)
    │       └── health/route.ts
    ├── core/                     # framework-free, deterministic, unit-tested
    │   ├── geometry/             # vec, polygon, clipper2 adapter, transforms, hit-test
    │   ├── pdf/                  # page model, page-id lineage (A2), sha256, vector extraction
    │   ├── calibration/          # scale detection, two-point calibration, unit conversion
    │   ├── measure/              # length, polyline, area, perimeter, angle, count
    │   ├── fill/                 # dynamic fill (ported from prototype)
    │   ├── snap/                 # flatbush segment index, snap resolution
    │   ├── markup/               # markup types, scene model, styles, layers, legend
    │   ├── commands/             # command objects (do/undo) → ops
    │   ├── sync/                 # op model, field-level LWW merge (A4), queue logic
    │   ├── btx/                  # .btx parser (zlib, PDF annot dict) → typed tools
    │   ├── toolchest/            # typed device model, native format
    │   ├── export/               # flatten, annotation export (A5), print layout, unflatten payload
    │   ├── compare/              # revision diff, auto-cloud
    │   ├── sprinkler/
    │   │   ├── rulesets/nzs4541.v1.json
    │   │   ├── placer/           # frame search, bays, row DP, stagger
    │   │   ├── oracle/           # independent checker (must not import placer)
    │   │   └── report/           # FR77 per-zone stats
    │   └── schema/               # Zod schemas shared by client/worker/server
    ├── workers/
    │   ├── render.worker.ts      # pdf.js page → tiles (ImageBitmap)
    │   ├── engine.worker.ts      # hash, vectors, snap index, fill, sprinkler
    │   ├── export.worker.ts      # @cantoo/pdf-lib writing
    │   └── rpc.ts                # typed message helpers
    ├── features/
    │   ├── viewer/               # canvas stack, tiles, pan/zoom, thumbnails, search, tabs
    │   ├── editor/               # editor store (zustand vanilla), tools, selection, undo UI
    │   ├── calibration/          # dialogs, FR82 prompt
    │   ├── markups-list/         # bottom panel, filters, CSV
    │   ├── tool-chest/           # left panel, .btx import UI
    │   ├── properties/           # right/left panel properties
    │   ├── sprinkler/            # zones UI, placement controls, overlay, report
    │   ├── export/               # flatten/export/print dialogs
    │   ├── page-edit/            # insert/delete/rotate/crop/merge (M4)
    │   ├── compare/              # M4
    │   ├── sharing/              # shares, realtime subscription (M4)
    │   ├── account/              # login forms, signature
    │   ├── company/              # members, invitations, roles (M3)
    │   └── admin/                # platform admin (M3)
    ├── components/ui/            # buttons, inputs, dialogs, menus, toasts, status bar primitives
    └── lib/
        ├── supabase/{client,server,admin}.ts
        ├── auth/get-auth-user.ts
        ├── db/                   # typed mappers per table (snake↔camel), RPC wrappers
        ├── idb/                  # IndexedDB: op queue, markup cache, tile cache
        ├── logger.ts
        ├── sentry.ts
        └── env.ts                # Zod-validated env
```

### Architectural Boundaries

**API boundaries:**
- Browser ↔ Supabase: PostgREST reads under RLS + RPCs (`apply_markup_ops`, `create_share`, …) — only via `src/lib/db/*`.
- Browser ↔ Next.js: server actions inside `src/features/*/actions.ts` (company/admin/account flows); route handlers only for storage signing and health.
- Platform admin writes go through server actions using the service client in `src/lib/supabase/admin.ts`, always writing `audit_log`; the service client is never imported into client components.

**Component boundaries:**
- `src/core` ← imported by `workers`, `features`, `lib`; imports nothing from them.
- `features/*` talk to each other only via the editor store and `lib`; no cross-feature deep imports.
- Canvas rendering reads the store; tools mutate via commands only.

**Worker boundaries:** three workers with typed messages; large data transferred, not cloned. The main thread never runs pdf.js parsing, hashing, fill, snap-index build or sprinkler placement.

**Data boundaries:**
- Postgres: identity, drawings/files/pages, markups, events, tools, zones/layouts, rules, shares, audit/activity.
- Storage bucket `drawings` (private): only when FR53 is on; path `<company_or_user>/<drawing_id>/<sha256>.pdf`.
- IndexedDB: op queue, cached markups, tile cache (evictable). Local PDFs stay in memory / File System Access handles — never uploaded unless FR53.

### Requirements to Structure Mapping

| PRD area / milestone | Main locations |
|---|---|
| Accounts, companies, admin (FR1–16, FR80) — M1 login, M3 rest | `app/(auth)`, `app/(admin)`, `features/{account,company,admin}`, `lib/auth`, `supabase/migrations`, `supabase/tests` |
| Document viewing (FR17–22, FR69) — M1 | `features/viewer`, `workers/render.worker.ts`, `core/pdf` |
| Calibration & measurement (FR23–30, FR82) — M1 | `core/{calibration,measure,snap,fill}`, `features/calibration`, `workers/engine.worker.ts` |
| Markup & as-built (FR31–38, FR67, FR83) — M1 | `core/{markup,commands}`, `features/{editor,properties}` |
| Tool Chest (FR39–44) — M1 (+ company sets M3) | `core/{btx,toolchest}`, `features/tool-chest` |
| Markups list, persistence, sharing (FR45–55, FR81) — M1/M4 | `features/{markups-list,sharing}`, `core/sync`, `lib/{db,idb}`, `app/api/storage` |
| Page edit, print, flatten, export (FR56–61, FR68, FR84) — M1/M4 | `core/{export,compare,pdf}`, `features/{export,page-edit,compare}`, `workers/export.worker.ts`, `docs/export-mapping.md` |
| Public site (FR62–66) — M4 | `app/(marketing)`, `public/{llms.txt,robots.txt}` |
| 4541 engine (FR70–79) — M2 | `core/sprinkler/*`, `features/sprinkler`, `fixtures/zones`, `e2e/sprinkler.spec.ts` |

**Cross-cutting:** auth (`proxy.ts`, `lib/auth`, RLS helpers in migrations); observability (`lib/{logger,sentry}`, `activity_events`); theming (`globals.css` tokens, `components/ui`); validation (`core/schema`).

### Integration Points

- **Internal:** UI → command → store → (a) canvas re-render, (b) op → IndexedDB queue → `apply_markup_ops` → server versions back into store. Realtime (shared drawings) → same merge path in `core/sync`.
- **External:** Supabase (Auth, Postgres, Storage, Realtime), Sentry, Vercel, transactional email via Supabase Auth SMTP (M3).
- **Data flow on open:** File → render worker (first tile) ∥ engine worker (sha256) → lookup `drawing_files.sha256` → load markups (IndexedDB first, then server) → FR81 hint if filename matches but hash differs.

### File Organization Patterns

- **Config:** root-level configs only; env validated in `lib/env.ts`; no secrets in `NEXT_PUBLIC_*` except the anon key and URL.
- **Source:** domain logic in `core`, UI in `features`, adapters in `lib`, routes thin.
- **Tests:** co-located unit tests; `supabase/tests` for RLS; `e2e/` Playwright; fixtures in `fixtures/` (private real drawings git-ignored).
- **Assets:** marketing images in `public/`; tool-chest symbols are data (DB/Storage), not static assets.

### Development Workflow Integration

- **Dev:** `supabase start` (Docker, custom ports to avoid clashes with other local projects) + `next dev` (Turbopack) on a non-3000 port.
- **Build:** `next build`; workers emitted as separate chunks; marketing routes statically rendered.
- **Deploy:** Vercel (`syd1`) from `main`; Supabase migrations applied via CI `supabase db push` on release; preview deploys per PR.

## Architecture Validation Results

### Coherence Validation ✅

**Decision compatibility:** Next.js 16.4 / React 19.3 / Tailwind 4.3 / Supabase JS 2.118 + SSR 0.12 / Zod 4.6 / pdfjs-dist 6.4 / @cantoo/pdf-lib 2.11 / zustand 5 / flatbush 4 / rbush 4 / Vitest 5 / Playwright 1.64 have no known conflicts. One watch item: TypeScript 7.0 (native compiler) — confirm Next.js, ESLint typed rules and Vitest work at scaffold; otherwise pin the latest 6.x/5.x (decided at story 1, not an architecture change).

**Pattern consistency:** naming (snake DB / camel TS with one mapper layer), result shape, op format and worker messages are used consistently across steps 4–6. Coordinates (PDF points) and A4 conflict rules are referenced the same way in data model, sync, commands and export.

**Structure alignment:** every step-4 decision has a home in the step-6 tree (core domains, three workers, `lib/db`, `lib/idb`, route groups). Lint-enforced boundaries (core purity, oracle independence, no service client in client code) match the patterns.

### Requirements Coverage Validation

**Functional requirements:** all 11 FR areas (FR1–FR84) map to locations in the step-6 table. A11 (fill stored as vector polygons) and A12 (prototype refactor, not copy) are reflected in `core/fill` and the patterns. FR84 compare has a home (`core/compare`) but no algorithm yet — see gaps.

**Non-functional requirements:** performance (NFR1–7: workers, tiles, spatial indexes, op budgets), accuracy (NFR8–10: PDF points, oracle, A9), data access (NFR20–26), files (NFR27–33), observability (NFR45–47) are covered. Items resolved in this step are listed below.

### Implementation Readiness Validation

Decisions carry verified versions; patterns have examples and anti-patterns; the tree is specific; integration points and data flow on open are defined. Remaining gaps are listed with resolutions.

### Gap Analysis Results

**Critical gaps:** none.

**Important gaps — resolved here:**
1. **CSP with nonces vs static marketing (NFR28):** nonce CSP forces dynamic rendering. Decision: nonce-based CSP in `proxy.ts` for `(workspace)`, `(auth)`, `(admin)`; hash-based CSP for statically rendered `(marketing)` pages.
2. **Bot protection (NFR15):** Cloudflare Turnstile through Supabase Auth's built-in CAPTCHA support on sign-up and password reset.
3. **Immediate session revocation (NFR17):** Supabase access JWTs stay valid until expiry, so `getAuthUser()` also checks `profiles.status = 'active'` (cheap indexed read) and JWT expiry is shortened to 10 min; deactivation/role/password change calls the admin sign-out to kill refresh tokens.
4. **CI completeness (NFR23/33/47):** add `supabase gen types` drift check (`src/lib/db/types.gen.ts`), gitleaks secret scan, `npm audit --audit-level=high` gate.
5. **"No PDF upload" proof (NFR26):** Playwright test opens a PDF, edits, saves, and asserts no request body contains PDF bytes and no Storage call occurs while FR53 is off.
6. **Non-PDF files:** private buckets `signatures` (FR83, path `<user_id>/…`) and `tool-assets` (tool symbols, path `<owner_id>/<tool_set_id>/…`), same signed-URL rule as NFR25.
7. **Spike order (A13):** implementation sequence starts with four spikes before feature stories — `.btx` parse+render → irregular placement + objective (Fable) → A0 render + 500-markup fps → annotation export round-trip in Revu.

**Important gaps — founder decisions (2026-10-16):**
8. **UX spec (A14):** run `bmad-create-ux-design` after this architecture and before epics; epics/stories reference the UX spec for first-run flow, save/sync status model, 4541 panel and empty/loading/error/offline states.
9. **Backups (NFR39):** dev/founder phase on the standard plan; Supabase Pro + 7-day PITR enabled before the first pilot company is onboarded (M3 gate item).

**Deferred / nice-to-have:**
- FR84 compare algorithm (M4): design spike before M4 (vector diff by page-id with raster fallback).
- Clipper2 JS binding: choose and pin at the placement spike.
- Transactional email provider for Supabase Auth SMTP (M3), e.g. Resend.
- Reference hardware and named perf fixtures (A10) recorded in `fixtures/README.md` at the render spike.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY WITH MINOR GAPS (no critical gaps; UX spec scheduled before epics; PITR is an M3 gate item; FR84 compare design deferred to a pre-M4 spike).

**Confidence level:** high for M1/M2 scope, medium for M4 compare.

**Key strengths:** drawings stay in the browser by design; framework-free core shared by workers and tests; independent 4541 oracle with founder-verified rule figures; security pitfalls from earlier projects designed out from day 1.

**Areas for future enhancement:** true content removal (redaction), real-time co-editing presence, PostGIS if server-side spatial queries appear, MFA.

### Implementation Handoff

**AI agent guidelines:** follow decisions and patterns exactly; respect the step-6 boundaries; treat this document as the source of truth; the 4541 placer/oracle are implemented by a Fable-model agent from `docs/4541-placement-design.md`.

**First implementation priority:**
```bash
npx create-next-app@latest plan-markup-app --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-npm
# app lives at the plan-markup/ repo root: scaffold into plan-markup-app/, then move its files up to the root (root already holds docs/, _bmad-output/, .claude/)
```
then `supabase init`, auth/RLS helpers, CI (incl. RLS + schema/type drift + secret scan), followed by the four A13 spikes.
