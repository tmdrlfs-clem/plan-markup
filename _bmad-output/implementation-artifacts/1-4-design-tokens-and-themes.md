# Story 1.4: Design tokens and themes

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a consistent, readable interface in the Blueprint theme with Daylight and High contrast available,
so that every screen looks like one product and is accessible from the first page.

## Acceptance Criteria

1. **Given** `src/app/globals.css`, **when** the app renders, **then** token sets for Blueprint (default: `<html data-theme="blueprint">`), Daylight and High contrast exist under `[data-theme="blueprint"|"daylight"|"contrast"]`. Each set has surfaces 0–3, border / border-strong, text / text-muted, accent / accent-fg, warning, danger, success and info. The sets also define radii 2/3/4 px, hard offset shadows (zero blur), the `ring-2` accent focus, a 4 px spacing base, z-layers, and the workspace and admin type scales (UX-DR1, UX-DR2).
2. High contrast values are defined in this story. The UX spec drafts only Blueprint and Daylight; start from the mockup's "Contrast" direction.
3. Inter loads via `next/font`, and numeric text uses tabular numerals (`tabular-nums` utility, plus a `.num` helper class or the equivalent token).
4. `src/components/ui/tokens.ts` exports the canvas-relevant tokens (read from the live CSS variables) and notifies subscribers when the theme changes.
5. Basic `Button` (variants primary / secondary / ghost / destructive) and `TextField` (label, hint, inline error) exist in `src/components/ui/`, so the auth screens in Story 1.5 can use them.
6. A unit test, run in CI by `npm test`, checks the listed contrast pairs for all three themes: text ≥4.5:1, UI components and graphics ≥3:1.

## Tasks / Subtasks

- [ ] **Task 1: Token CSS** (AC: 1, 2)
  - [ ] Rewrite `src/app/globals.css`. Remove the scaffold's `:root` / `prefers-color-scheme` / Geist / Arial rules.
  - [ ] Define raw variables per theme under `[data-theme="…"]` (Dev Notes → Token values). Map them into Tailwind with `@theme inline { --color-surface-0: var(--surface-0); … }` so utilities like `bg-surface-1`, `text-muted`, `border-strong`, `bg-accent` and `text-danger` follow the active theme.
  - [ ] **Radii:** reset the namespace with `--radius-*: initial;`, then define `--radius-sm: 2px; --radius-md: 3px; --radius-lg: 4px;`. Make bare `rounded` resolve to 2 px. Keep `rounded-full` only for genuinely round things (radio dots, avatars).
  - [ ] **Shadows:** reset with `--shadow-*: initial;`, then define hard offsets `--shadow-1: 2px 2px 0 <c>`, `--shadow-2: 4px 4px 0 <c>`, `--shadow-3: 8px 8px 0 <c>`. Take the colour per theme from the mockup (`rgba(0,0,0,.45)` for Blueprint, `rgba(20,22,26,.10)` for Daylight, orange `rgba(255,138,42,.35)` for Contrast). Never use blur.
  - [ ] **Focus:** a global `:focus-visible` style using a 2 px accent ring with a 2 px offset in the surface colour, plus a `focus-ring` utility for components.
  - [ ] **Spacing:** `--spacing: 4px` (the Tailwind v4 base), so `p-1` = 4 px, `p-2` = 8 px.
  - [ ] **Z-layers:** `--z-canvas: 0`, `--z-panel: 10`, `--z-toolbar: 20`, `--z-popover: 40`, `--z-dialog: 50`, `--z-toast: 60`, `--z-tooltip: 70`, exposed as `z-popover` etc.
  - [ ] **Type scales:** workspace `--text-ws-xs: 11px`, `ws-sm: 12px`, `ws-md: 13px`, `ws-lg: 14px`, `ws-xl: 16px`; admin `--text-ad-sm: 14px`, `ad-md: 16px`, `ad-lg: 20px`, `ad-xl: 24px`, `ad-2xl: 32px`, `ad-3xl: 40px`. Line-height is 1.5 for body sizes and 1.2 for 20 px and above. Weights 400/500/600 only.
  - [ ] `body` uses `bg-surface-0 text-text font-sans`.
  - [ ] **Self-test:** `src/components/ui/tokens-css.test.ts` parses `globals.css` and asserts:
    - each of the three theme blocks defines every required variable (one shared list in `src/components/ui/token-names.ts`);
    - no shadow value has a non-zero blur.
- [ ] **Task 2: Font and root layout** (AC: 1, 3)
  - [ ] `src/app/layout.tsx`: replace Geist with `Inter` from `next/font/google` (`subsets: ['latin']`, `variable: '--font-inter'`, `display: 'swap'`), and set `--font-sans` to it in `@theme`. Set `<html lang="en" data-theme="blueprint" className={inter.variable}>`. Keep `metadata.title = "Plan Markup"` (the e2e smoke test checks it).
  - [ ] JetBrains Mono is **not** needed yet. Do not add it.
- [ ] **Task 3: Canvas token bridge** (AC: 4)
  - [ ] `src/components/ui/tokens.ts` (client-only module):
    - `type Theme = 'blueprint' | 'daylight' | 'contrast'`, plus `THEMES` and `DEFAULT_THEME = 'blueprint'`;
    - `readCanvasTokens(el = document.documentElement): CanvasTokens` reads the CSS variables for selection (accent plus a dark companion outline, see Dev Notes → Canvas pairs), halo, snap (info), danger, warning, success, coverage fill/outline, zone outline, surround (`surface-0`), handle size (px) and font family;
    - `setTheme(theme)` sets `data-theme` on `<html>`;
    - `subscribeCanvasTokens(cb): () => void` uses one shared `MutationObserver` on the `data-theme` attribute, calls `cb(readCanvasTokens())` after each change, and returns an unsubscribe function.
    Persistence (profile/localStorage) and the Settings → Appearance UI are **not** in this story; they come with `profiles.theme` in Epic 3.
  - [ ] Tests (jsdom): setting the theme notifies subscribers once per change; unsubscribing stops the calls; `readCanvasTokens` returns the values defined on the element (set the CSS variables inline in the test, because jsdom does not load `globals.css`).
- [ ] **Task 4: Button and TextField** (AC: 5)
  - [ ] `src/components/ui/button.tsx`: `Button` with `variant: 'primary'|'secondary'|'ghost'|'destructive'` (default secondary) and `size: 'sm'|'md'`. Heights: `sm` 28 px for the workspace, `md` 40 px for admin/auth forms (minimum hit targets from the UX spec). Use `forwardRef`. `type="button"` is the default. `disabled` keeps the button visible.
    - Primary: accent fill with accent-fg text.
    - Secondary: `border-strong` outline.
    - Ghost: no border until hover.
    - Destructive: danger outline (the danger fill is reserved for confirm dialogs and arrives in Story 1.7).
    - All variants use radius 2 px and show the focus ring. Implement variants with a small local `cva`-style map; do not add `class-variance-authority` or `clsx` unless you pin them exactly.
  - [ ] `src/components/ui/text-field.tsx`: `TextField` with label above (admin/auth style), `id` wiring (`useId`), optional hint, and an `error` string. The error shows inline under the field in danger colour with an icon (`lucide-react` `CircleX` or `XCircle`) plus the text, and sets `aria-invalid` and `aria-describedby`. Types: text / email / password (a show/hide toggle for password is welcome but optional; Story 1.5 needs it). Height 40 px, radius 2 px, `border-strong` border, focus ring.
  - [ ] Vitest and Testing Library setup:
    - add exact dev deps `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `@testing-library/jest-dom` and `jsdom` (pin the latest versions with `npm view`, `-E`), plus `@vitejs/plugin-react` if it is needed for JSX;
    - use the jsdom environment only for `*.test.tsx` and DOM tests (`environmentMatchGlobs` or a per-file `// @vitest-environment jsdom` comment);
    - keep `src/core` tests on `node`.
  - [ ] Tests:
    - Button renders each variant, fires `onClick`, does not fire when disabled, and is reachable by Tab;
    - TextField's label is associated (`getByLabelText`), and an error sets `aria-invalid` and is announced through `aria-describedby`.
- [ ] **Task 5: Contrast test** (AC: 6)
  - [ ] `src/components/ui/contrast.ts`: a pure WCAG 2.1 relative-luminance and contrast-ratio function (sRGB, hex `#RGB`/`#RRGGBB` input, plus alpha compositing over a given background for `rgba`), with unit tests against known values (`#000` on `#fff` = 21, `#777` on `#fff` ≈ 4.48).
  - [ ] `src/components/ui/contrast-pairs.ts`: the pair list (Dev Notes → Contrast pairs) with the kind (`text` 4.5 / `ui` 3.0) for each pair.
  - [ ] `src/components/ui/contrast.test.ts`: for each theme block parsed from `globals.css`, assert every pair. The failure message names the theme, the pair, the ratio and the required minimum. **If a draft value fails, adjust the token** (smallest change that passes, same hue) and list every change in the Completion Notes. Never lower a threshold or drop a pair.
- [ ] **Task 6: Default page** (AC: 1, 5)
  - [ ] Replace the scaffold's `src/app/page.tsx` with a minimal token-styled placeholder: "Plan Markup" heading (admin scale), one sentence, and a row with the four `Button` variants and one `TextField`. It must stay a server component except for small client parts. Story 1.8 replaces it with the workspace shell. Delete the unused scaffold SVGs in `public/` (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`) if nothing references them.
- [ ] **Task 7: Guard against off-token styles** (AC: 1)
  - [ ] `tools/lint/near-sharp.test.ts`: scans `src/**/*.{ts,tsx,css}` (except tests) and fails on the off-token classes and values listed in Dev Notes → Near-sharp guard.
- [ ] **Task 8: Verify** (AC: 1–6)
  - [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`, `npm run check:pinned`.
  - [ ] Run the dev server on 3020. Use Playwright (or a quick script) to take screenshots of `/` with `data-theme` set to each of the three themes, and save them to `test-results/` (git-ignored). Report the paths so the orchestrator can look at them.
  - [ ] **Do not commit or push.** Stop the dev server and free port 3020.

## Dev Notes

### Context

Done so far:
- Story 1.1: Next 16.4.2, React 19.3.1, Tailwind 4.3.3 through `@tailwindcss/turbopack` (no postcss config), TypeScript 6.0.3, ESLint 9 boundaries, Vitest 5 (`vitest.config.mts`, node env), Playwright smoke test (checks title "Plan Markup"), port 3020. `cacheComponents` is off.
- Story 1.2: CI (`ci.yml`) and lint-boundary tests in `tools/lint/`.
- Story 1.3: local Supabase with `profiles` and RLS. It is in parallel or just finished, so do not touch `supabase/`, `scripts/check-rls*`, `scripts/check-*-drift*` or `.github/workflows/db.yml`.

`radix-ui@1.8.1` and `lucide-react@1.58.0` are already installed (exact pins). Radix wrappers (Dialog, Menu, Tooltip…) are **Story 1.7**: do not build them here.

### Token values (start here, then adjust only to pass contrast)

| Variable | Blueprint (default) | Daylight | Contrast |
|---|---|---|---|
| `--surface-0` | `#10151C` | `#D9DBDF` | `#050505` |
| `--surface-1` | `#161D26` | `#F7F7F8` | `#0B0B0C` |
| `--surface-2` | `#1D2631` | `#FFFFFF` | `#121214` |
| `--surface-3` | `#25303D` | `#EFEFF1` | `#1A1A1D` |
| `--border` | `#2C3846` | `#D9DADE` | `#2A2A2E` |
| `--border-strong` | `#425265` | `#B8BAC0` | `#55555C` |
| `--text` | `#E6ECF2` | `#16181B` | `#FFFFFF` |
| `--text-muted` | `#94A3B4` | `#5B6068` | `#B5B5BC` |
| `--accent` | `#FF7A1A` | `#E8620C` | `#FF8A2A` |
| `--accent-fg` | `#1A0E05` | `#FFFFFF` | `#000000` |
| `--warning` | `#F2D24B` | `#A57F00` | `#FFE066` |
| `--danger` | `#F04D5E` | `#C8243A` | `#FF5C70` |
| `--success` | `#3FBF7F` | `#1F8A55` | `#4BE39A` |
| `--info` | `#6CA8FF` | `#2563C9` | `#7DB6FF` |

The Blueprint and Contrast values come from the founder-approved mockup `_bmad-output/planning-artifacts/ux-design-directions.html` (directions 3 and 5). Daylight comes from direction 4 / UX spec Color System. The fixed AC values (warning `#F2D24B`, danger `#F04D5E`) apply to Blueprint. Expect Daylight `--accent` (`#E8620C` with white text ≈ 3.4:1) and `--warning` (`#A57F00` on white ≈ 3.7:1) to fail 4.5:1 *as text*. The fix is to darken the token, or to add a separate `--accent-strong` / `--warning-text` token for text use while keeping the fill colour. Record the choice.

Also add `--accent-soft` (accent at 12–18 % alpha, for active-tool backgrounds), plus the canvas tokens `--canvas-halo: #FFFFFF`, `--canvas-selection-outline` (a dark companion of the accent, e.g. `#1A0E05`), `--canvas-coverage-fill` (info at ≈18 % alpha), `--canvas-zone` (muted violet, e.g. `#8B7FD1` dark / `#6A5BC2` light) and `--canvas-handle-size: 8px`.

### Contrast pairs (per theme)

- **text (≥4.5):**
  - `text` on `surface-0`, `surface-1`, `surface-2` and `surface-3`;
  - `text-muted` on `surface-1` and `surface-2`;
  - `accent-fg` on `accent`;
  - `danger`, `success` and `info` on `surface-1`, when used as text (or their `-text` variants if you introduce them);
  - the warning text token on `surface-1`.
- **ui (≥3.0):**
  - `border-strong` on `surface-1` (control outlines);
  - `accent` on `surface-0` and `surface-1` (focus ring, selection in chrome);
  - `warning`, `danger`, `success` and `info` on `surface-1` (icons).
- **Canvas pairs (ui ≥3.0, against the white sheet `#FFFFFF`):**
  - the `info` snap glyph;
  - `danger` rule-break markers;
  - the selection: **either** `accent` **or** `--canvas-selection-outline` must reach 3:1 on white. Orange on white is ≈2.6:1, so the dark companion outline carries the contrast. Test it as "max(accent, outline) ≥ 3".

### Near-sharp guard

Fail on these, outside test files:
- `rounded-(md|lg|xl|2xl|3xl)` used with the old Tailwind meaning: after the namespace reset only `sm`/`md`/`lg` exist and map to 2/3/4 px, so allow `rounded`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-none` and `rounded-full`, and fail on `rounded-xl` and larger;
- `shadow-(sm|md|lg|xl|2xl|inner)`;
- `blur-*` and `backdrop-blur-*`;
- raw `box-shadow` values with a non-zero third length.

Design preference (founder, standing): radius 2–4 px, hard offset shadows with no blur, `ring-2` focus.

### Pitfalls

- Tailwind v4 is CSS-first: no `tailwind.config.js`. Tokens live in `@theme` and the `[data-theme]` blocks.
- Only variables declared inside `@theme` generate utilities. Variables that change per theme must be referenced through `@theme inline`, otherwise the utility bakes in the first value.
- `next/font/google` downloads at build time. CI has network access; this machine too.
- `tokens.ts` touches `document`. It lives in `src/components/ui` (allowed); never import it from `src/core` (lint blocks that).
- English only. Kebab-case files (`text-field.tsx` exports `TextField`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Design tokens and themes]
- [Source: _bmad-output/planning-artifacts/epics.md#UX Design Requirements] (UX-DR1, UX-DR2)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation], [#Design Direction Decision], [#Button Hierarchy], [#Form Patterns], [#Accessibility Strategy]
- [Source: _bmad-output/planning-artifacts/ux-design-directions.html] (direction token sets 3, 4, 5)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
