# Story 1.7: Foundation components

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want menus, dialogs, tooltips and fields that behave the same everywhere,
so that the interface is predictable and fully keyboard accessible.

## Acceptance Criteria

1. **Given** the tokens from Story 1.4, **when** foundation components are built in `src/components/ui/*` as Radix (`radix-ui` 1.8.1) wrappers, **then** these exist: IconButton (tooltip = name + shortcut, `aria-keyshortcuts`), ToggleButton, ToggleGroup, Toolbar, Menu, MenuBar, ContextMenu, Dialog, AlertDialog, Popover, Tooltip, Tabs, Collapsible, Select, NumberField, Slider paired with NumberField (SliderField), ColorSwatch, Checkbox, Panel (collapsible, resizable), StatusBarItem and Toast. Each has a co-located Vitest + Testing Library test (jsdom) for keyboard and focus behaviour (UX-DR4).
2. Chrome icons use `lucide-react` 1.58.0 only. A lint rule bans other icon packages in `src/components`, `src/features` and `src/app`, with a lint test proving it.
3. Toast follows the feedback rules: bottom-right, 4 s, pauses on hover (and on focus), max 3 visible, identical toasts merge with a count ("×2"); at most one action. Semantic variants (success / warning / danger / info) always carry an icon and text; orange (`accent`) is never used as a status colour (UX-DR33).
4. NumberField parses "4.6", "4600 mm", "4.6m" and `15'6"`, normalises on blur to the display unit, shows the unit suffix, and steps with ArrowUp/ArrowDown (Shift ×10). Invalid input shows an inline error on blur (never per keystroke) and keeps the last valid value (UX-DR34). The parser is a pure function in `src/core/geometry/length.ts` with its own unit tests.
5. Dialogs put secondary left / primary right; Enter = primary, Esc = cancel; focus returns to the trigger on close. AlertDialog confirms state the scope and use a danger-filled primary (UX-DR32).
6. Every component uses tokens only (no raw hex, no blur shadows, radii 2–4 px), shows the global focus ring on keyboard focus, and its test checks accessibility through Testing Library role/name queries plus the explicit attribute assertions listed in Dev Notes (no axe dependency is added).
7. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass; existing tests stay green.

## Tasks / Subtasks

- [x] **Task 1: Shared helpers** (AC: 1, 6)
  - [x] `src/components/ui/cx.ts`: `cx(...parts: Array<string | false | null | undefined>)` joins truthy class names. Refactor `button.tsx` and `text-field.tsx` to use it (behaviour unchanged, their tests stay green).
  - [x] `src/components/ui/shortcut.ts`: `formatShortcut("Ctrl+Shift+M")` → display string `"Ctrl+Shift+M"` (on macOS `⌘⇧M`, detect via `navigator.platform`/`userAgentData` guarded for SSR) and `toAriaKeyShortcuts("Ctrl+Shift+M")` → `"Control+Shift+M"` (maps Ctrl→Control, Del→Delete, Esc→Escape, `+`→`Plus`, `-`→`Minus`; multiple shortcuts joined by space). Unit tests.
  - [x] `src/test/radix-jsdom.ts`: jsdom polyfills Radix needs (`hasPointerCapture`, `setPointerCapture`, `releasePointerCapture`, `scrollIntoView`, `ResizeObserver`, `DOMRect`). Import it from each jsdom test that needs it (do **not** add it to `vitest.setup.ts`, which also runs in the node environment), or guard it with `typeof window !== "undefined"` if added to setup.
- [x] **Task 2: Tooltip, IconButton, ToggleButton, ToggleGroup, Toolbar** (AC: 1, 2)
  - [x] `tooltip.tsx`: `TooltipProvider` (delayDuration 400, skipDelayDuration 300) and `Tooltip({ content, shortcut?, side?, children })`. Content shows the label plus the shortcut in a muted `kbd`. z-index `z-tooltip`, `shadow-1`, surface-3, `text-ws-sm`.
  - [x] `icon-button.tsx`: `IconButton({ label, icon, shortcut?, disabledReason?, size?: "sm" | "md", ... })`. Renders a ghost button (28 px sm / 32 px md square), `aria-label={label}`, `aria-keyshortcuts` when `shortcut` is set, wrapped in Tooltip whose text is `label` (+ shortcut). When disabled, use `aria-disabled="true"` instead of the `disabled` attribute so it stays focusable and the tooltip shows `disabledReason` (UX-DR32 "disabled buttons explain why"); clicks are swallowed.
  - [x] `toggle-button.tsx`: Radix `Toggle` with the IconButton look; pressed = accent fill (`bg-accent text-accent-fg`) **and** a shape change (inset 2 px bottom bar) so state is not colour-only. Same `label/icon/shortcut/disabledReason` API.
  - [x] `toggle-group.tsx`: Radix `ToggleGroup` (`type="single" | "multiple"`), items reuse the ToggleButton styling; roving focus with arrow keys; `aria-label` required.
  - [x] `toolbar.tsx`: Radix `Toolbar` root (`orientation`, required `aria-label`), plus `ToolbarButton` (IconButton as `Toolbar.Button asChild`), `ToolbarToggleGroup`, `ToolbarSeparator`. Arrow keys move between items; Tab leaves the toolbar.
- [x] **Task 3: Menu, MenuBar, ContextMenu** (AC: 1)
  - [x] One shared item style module `menu-styles.ts` (row 28 px, `text-ws-md`, highlighted = `bg-surface-3` + accent left bar, disabled = muted, shortcut right-aligned in muted text, submenu chevron `ChevronRight`).
  - [x] `menu.tsx`: DropdownMenu wrapper — `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem({ shortcut?, icon?, destructive? })`, `MenuCheckboxItem`, `MenuRadioGroup`/`MenuRadioItem`, `MenuSeparator`, `MenuLabel`, `MenuSub`/`MenuSubTrigger`/`MenuSubContent`. Items with a shortcut set `aria-keyshortcuts`.
  - [x] `menu-bar.tsx`: Radix `Menubar` wrapper with the same item components (re-export the same API names under a `MenuBar*` prefix). Left/Right moves between top-level menus while open.
  - [x] `context-menu.tsx`: Radix `ContextMenu` wrapper with the same item API; also opens with Shift+F10 / the ContextMenu key on the focused trigger (Radix handles the `contextmenu` event; add a keydown handler that dispatches it for Shift+F10).
- [x] **Task 4: Dialog, AlertDialog, Popover** (AC: 1, 5)
  - [x] `dialog.tsx`: `Dialog({ open?, onOpenChange?, trigger?, title, description?, children, footer })` plus `DialogFooter({ secondary, primary })` that renders secondary left / primary right. Overlay `bg-black/50` (no blur), content `surface-1`, `shadow-3`, `rounded-lg`, max width prop (`sm` 400 / `md` 560 / `lg` 720). Close `IconButton` (X) top-right with label "Close".
  - [x] **Enter = primary:** a keydown on the dialog content: Enter (no modifiers, not composing) triggers the primary action unless focus is in a `textarea`, a `button` (native Enter already activates it), or an element with `data-enter-ignore`. The primary is identified by a `DialogPrimary` context/ref, not by DOM order.
  - [x] Esc closes (Radix default) and focus returns to the trigger (Radix default when using `Dialog.Trigger`; when controlled without a trigger, accept `returnFocusRef` and focus it in `onCloseAutoFocus`).
  - [x] `alert-dialog.tsx`: Radix `AlertDialog` with `title`, `description` (the scope sentence, e.g. "Delete 3 pages from L17 RCP?"), `cancelLabel` (default "Cancel"), `actionLabel` (a verb, required), `destructive?` (danger fill on the action). Initial focus on Cancel. Same footer order and Enter rule.
  - [x] `popover.tsx`: `Popover({ trigger, children, side?, align? })`, `surface-2`, `shadow-2`, `z-popover`; Esc closes and returns focus.
- [x] **Task 5: Tabs, Collapsible, Select, Checkbox** (AC: 1)
  - [x] `tabs.tsx`: `Tabs`, `TabsList` (required `aria-label`), `TabsTrigger`, `TabsContent`. Active tab = text colour + 2 px accent bottom border. Arrow keys move, Home/End jump (`activationMode="automatic"`).
  - [x] `collapsible.tsx`: `Collapsible({ title, defaultOpen?, open?, onOpenChange?, actions?, children })` with a full-width header button (`ChevronRight` rotates 90° when open, no transition under `prefers-reduced-motion`), `aria-expanded` from Radix.
  - [x] `select.tsx`: `Select({ label, value, onValueChange, options: {value,label,disabled?}[], placeholder?, layout?: "workspace" | "admin", error? })`. Workspace = label-left 12 px, 28 px field; admin = label-above 14 px, 40 px field (UX-DR34). Trigger has `ChevronDown`; content `z-popover`. Typeahead and arrow keys from Radix.
  - [x] `checkbox.tsx`: Radix `Checkbox` with a `Label`, supports `"indeterminate"` (`Minus` icon), checked = accent fill + `Check` icon. Space toggles; clicking the label toggles.
- [x] **Task 6: Length parsing and NumberField** (AC: 4)
  - [x] `src/core/geometry/length.ts` (framework-free, obeys the core lint rules): `parseLength(input, defaultUnit) → { ok: true, mm: number } | { ok: false, reason: "empty" | "invalid" | "negative" }` and `formatLength(mm, unit, { decimals? })`. Units: `"mm" | "m" | "ft-in"`. See Dev Notes → Length grammar. Reuse `MM_PER_INCH` from `units.ts`.
  - [x] `src/core/geometry/length.test.ts`: every row of the grammar table plus rounding and round-trip cases.
  - [x] `src/components/ui/number-field.tsx`: two modes behind one component:
    - `kind="length"`: value in **mm** (`value: number | null`, `onValueChange(mm)`), `unit` = display unit, parses with `parseLength`, suffix shows `mm` / `m` / nothing for ft-in (the formatted text carries `'` and `"`).
    - `kind="number"`: plain numbers with an optional `suffix` (e.g. `%`, `pt`), accepts an optional trailing suffix in the input ("40%" = 40).
    - Shared: `label`, `min`, `max`, `step` (in display units; length mode converts), `layout` (workspace/admin like Select), `error` (external), `disabled`. `role="spinbutton"` input with `aria-valuenow` / `aria-valuemin` / `aria-valuemax` / `aria-valuetext` (formatted with unit). ArrowUp/ArrowDown step, Shift ×10, clamp to min/max, PageUp/PageDown = ×10 too. Typing never reformats; blur (and Enter) commits: valid → `onValueChange` + normalised text; invalid → inline error under the field ("Enter a length like 4.6 m or 15'6\"" / "Enter a number") with `aria-invalid` and the value unchanged. Escape reverts the text to the last committed value.
  - [x] `number-field.test.tsx`: the four AC inputs, blur normalisation, arrow + Shift stepping, clamping, invalid → error on blur only, Escape revert, `aria-*` attributes.
- [x] **Task 7: Slider + SliderField, ColorSwatch** (AC: 1)
  - [x] `slider.tsx`: Radix `Slider` (single thumb), track `surface-3`, range `accent`, thumb 14 px square-ish (`rounded-sm`) with `ring-2` on focus. Not exported for standalone use in features: export `SliderField` that pairs it with a NumberField sharing one value, shows the limits at both ends ("1.8 — 4.6 m" style labels under the track), and one label for both (the slider gets `aria-labelledby` the label, the field gets the same label text). Keyboard: Radix arrows/PageUp/PageDown/Home/End on the thumb.
  - [x] `color-swatch.tsx`: `ColorSwatch({ color, label, selected?, onSelect })` a 20 px square button with `aria-label={label}` (colour name, e.g. "Red"), `aria-pressed` when selectable, selected = 2 px text-colour outline + `Check` glyph in a contrasting colour (not colour-only). Plus `ColorSwatchGroup({ colors: {value,label}[], value, onValueChange, aria-label })` as a radio group (`role="radiogroup"`, arrow keys roving focus) for Properties / Popover colour pickers. Swatch colours are data (markup colours), so they are the one place inline `style={{ backgroundColor }}` is allowed.
- [x] **Task 8: Panel, StatusBarItem** (AC: 1)
  - [x] `panel.tsx`: `Panel({ title, side: "left" | "right" | "bottom", collapsed, onCollapsedChange, size, onSizeChange, minSize, maxSize, actions?, children })` — controlled; persistence is the caller's job (Story 1.8). Header with title + actions + collapse IconButton (`PanelLeftClose`/`PanelLeftOpen` etc., label "Collapse <title>" / "Expand <title>"). Resize handle = `role="separator"`, `aria-orientation`, `aria-valuenow/min/max`, `aria-controls` the panel body, `tabIndex=0`; pointer drag (pointer capture) and keyboard (Arrow ±8 px, Shift ±32 px, Home = min, End = max, Enter toggles collapse). Size clamped to [minSize, maxSize]. Collapsed = body hidden (`hidden` attribute), handle not rendered. Landmark: `<section aria-label={title}>` (the shell decides `complementary`/`navigation` in 1.8 via an `as` / `role` prop).
  - [x] `status-bar-item.tsx`: `StatusBarItem({ label, icon?, tone?: "default" | "success" | "warning" | "danger" | "info", onClick?, tooltip? })` — 24 px tall, `text-ws-xs`, tabular numerals. Renders a `button` when `onClick` is set, otherwise a `span`. A non-default tone always shows its icon (CircleCheck / TriangleAlert / CircleX / Info) — colour never alone.
- [x] **Task 9: Toast** (AC: 3)
  - [x] `src/components/ui/toast-store.ts`: a tiny vanilla store (`zustand/vanilla` is already a dependency) with `toast({ title, description?, variant?: "neutral" | "success" | "warning" | "danger" | "info", action?: { label, onAction } })`, `dismiss(id)`. Merge key = `variant + title + description`; a duplicate while visible bumps `count` and restarts its timer instead of adding. Queue: max 3 visible; extra toasts wait and appear as others close (FIFO). Pure logic is unit-tested without React.
  - [x] `toast.tsx`: `Toaster` (Radix `Toast.Provider` with `duration={4000}`, `swipeDirection="right"`, `Toast.Viewport` fixed bottom-right, 16 px inset, `z-toast`, `label="Notifications (F8)"`) reading the store. Each toast: icon + title (+ "×N" count badge when N > 1) + description + optional action (`Toast.Action altText`) + close IconButton. Radix pauses on hover and focus and on window blur. `neutral` has no icon; semantic variants always have icon + text; no variant uses `accent`.
  - [x] Tests: 4 s auto-dismiss (fake timers), hover pauses, max 3 + queue, merge with count, action fires and dismisses, F8 focuses the viewport.
- [x] **Task 10: Lint and exports** (AC: 2)
  - [x] Add to the UI-layers `no-restricted-imports` block in `eslint.config.mjs` (repeat existing patterns; flat config replaces options): ban `react-icons`, `react-icons/*`, `@radix-ui/react-icons`, `@heroicons/*`, `@tabler/*`, `@phosphor-icons/*` with message "Chrome icons come from lucide-react only (UX-DR4)." Also ban the individual `@radix-ui/react-*` packages ("Import primitives from radix-ui").
  - [x] Extend the existing lint test (see `eslint` tests from Stories 1.2/1.5/1.6) with a fixture importing `react-icons/fa` in `src/components/` that must error.
  - [x] No barrel file: features import from `@/components/ui/<name>` (keeps tree-shaking obvious and matches the existing `button` / `text-field` imports).
- [x] **Task 11: Verify** (AC: 7)
  - [x] `npm run typecheck && npm run lint && npm test && npm run build`. Record counts in the Debug Log.
  - [x] Commit (one implementation commit), push, and record CI run ids.

## Dev Notes

### Context

Story 1.8 (Empty workspace shell) composes these components into the real layout, and every later feature must use them ("Features compose foundation components only — no raw styled HTML controls in features", UX spec → Component Implementation Strategy). So this story owns the **look and keyboard behaviour**; layout, persistence and app wiring are 1.8's job. The virtualised `Table` listed in UX-DR4 is **not** in this story's AC; it ships with the Markups List.

### Facts carried from earlier stories (must follow)

- Language: all code, comments, UI text, test names and commits in English.
- Tests are co-located (`x.tsx` + `x.test.tsx`). DOM tests start with `// @vitest-environment jsdom` (vitest default env is `node`). `vitest.setup.ts` already registers jest-dom and cleanup.
- Existing `Button` (variants primary/secondary/ghost/destructive, sizes sm 28 px / md 40 px) and `TextField` stay the source for button and field looks; reuse their classes rather than inventing new ones.
- Tokens (Story 1.4, `globals.css`): `bg-surface-0..3`, `border-border`, `border-strong`, `text-text`, `text-muted`, `bg-accent`, `text-accent-fg`, `text-warning` / `text-warning-text`, `text-danger`, `text-success`, `text-info`, radii `rounded-sm` 2 / `rounded-md` 3 / `rounded-lg` 4 (bare `rounded` = 2), `shadow-1/2/3` (hard offsets, zero blur), `focus-ring` utility, `z-panel/toolbar/popover/dialog/toast/tooltip`, type `text-ws-xs..xl` and `text-ad-sm..3xl`. Use `text-warning-text` (not `text-warning`) for warning **text** on light surfaces (Daylight contrast).
- Near-sharp design: radii 2–4 px only, hard offset shadows, `ring-2` focus. No blur shadows, no `backdrop-blur`, no large radii. `rounded-full` only for genuinely round things.
- CSP (Story 1.6): `style-src-attr 'unsafe-inline'` is allowed, so Radix inline positioning styles and the swatch `backgroundColor` work. Do **not** inject `<style>` elements at runtime.
- React 19.3.1: the existing components use `forwardRef`; keep that style for consistency (ref-as-prop is also fine, but do not mix in one file). Components with state/effects/Radix start with `"use client"`.
- UI layers must not import `@supabase/*` or `@sentry/*` (existing lint).
- `src/core/**` is framework-free (no React, no DOM globals); the length parser lives there.
- No new runtime dependencies are needed (`radix-ui` 1.8.1, `lucide-react` 1.58.0, `zustand` 5.0.15 are installed; all Radix primitives used here are exported by the `radix-ui` umbrella package: verified `Toolbar, Menubar, DropdownMenu, ContextMenu, Dialog, AlertDialog, Popover, Tooltip, Tabs, Collapsible, Select, Slider, Checkbox, Toggle, ToggleGroup, Toast, Label, VisuallyHidden, Separator`). If something truly needs a new dependency, stop and ask (two-week version rule).

### Sizes and density (workspace = dense)

| Element | Size |
|---|---|
| IconButton / ToggleButton sm | 28×28 px, icon 16 px |
| IconButton md | 32×32 px, icon 18 px |
| Toolbar row | 36 px |
| Menu row | 28 px, `text-ws-md`, 8 px horizontal padding, min width 200 px |
| Workspace field (Select / NumberField) | 28 px, `text-ws-md`, label-left 12 px (`text-ws-sm`), label column 96 px default |
| Admin field | 40 px, `text-ad-sm`, label-above 14 px (matches TextField) |
| StatusBarItem | 24 px, `text-ws-xs` |
| Panel header | 32 px, `text-ws-sm` uppercase-free, weight 600 |
| Tooltip | `text-ws-sm`, 4×8 px padding, max width 280 px |
| Toast | width 360 px, `text-ws-md`, `shadow-2` |

Icons: `lucide-react`, `aria-hidden="true"`, `strokeWidth` default, size per table. Icon-only controls always have an accessible name.

### Shortcut strings

Shortcuts are written in the UX table form (`"Ctrl+Shift+M"`, `"Shift+Alt+L"`, `"V"`, `"Del"`). `IconButton`/`MenuItem` take that string, display it via `formatShortcut`, and set `aria-keyshortcuts` via `toAriaKeyShortcuts`. This story does **not** register key handlers; the command/shortcut registry comes with the workspace stories.

### Length grammar (`parseLength`)

Whitespace is trimmed and ignored between number and unit; case-insensitive; a comma decimal separator is **not** accepted (NZ uses `.`). Negative values → `negative`. Empty → `empty`.

| Input | defaultUnit | Result (mm) |
|---|---|---|
| `4.6` | `m` | 4600 |
| `4.6` | `mm` | 4.6 |
| `4600 mm` | `m` | 4600 |
| `4600mm` | any | 4600 |
| `4.6m` | `mm` | 4600 |
| `4.6 M` | any | 4600 |
| `46 cm` | any | 460 |
| `.5m` | any | 500 |
| `15'6"` | any | 4724.4 (15 ft 6 in = 186 in × 25.4) |
| `15' 6"` | any | 4724.4 |
| `15'` | any | 4572 |
| `6"` | any | 152.4 |
| `15ft 6in` | any | 4724.4 |
| `15-6` | `ft-in` | 4724.4 (Revu-style feet-inches) |
| `15.5'` | any | 4724.4 |
| `6 1/2"` | any | 165.1 |
| `4.6` | `ft-in` | 1402.08 (bare number = feet) |
| `abc`, `4.6 kg`, `1..2`, `4.6m 3` | any | invalid |
| `-1` | any | negative |

Typographic quotes `′ ″ ’ ”` are accepted as `'` and `"`. Results are not rounded inside the parser; `formatLength` rounds for display: `mm` → integer (`4600 mm`), `m` → up to 3 decimals trimmed (`4.6 m`), `ft-in` → nearest 1/8 in (`15'6"`, `15'6 1/2"`, `0'6"`).

NumberField length mode shows the suffix **outside** the input text (a muted suffix element, `aria-hidden`) for `mm`/`m`; the committed input text is the bare number (`4.6`). For `ft-in` the input text itself is `15'6"` and no suffix is shown. `aria-valuetext` always has the unit ("4.6 m", "15 feet 6 inches").

### Dialog keyboard rules (UX-DR32)

- Footer order: secondary (Cancel) left, primary right, `justify-end gap-2`; extra buttons (e.g. "Back") go to the far left.
- Enter = primary (see Task 4 exceptions). If the primary is disabled, Enter does nothing.
- Esc = cancel = close without applying. Overlay click also closes Dialog (not AlertDialog).
- Initial focus: first focusable field, else the primary for Dialog; Cancel for AlertDialog.
- Close returns focus to the trigger (test this explicitly: open via a button, press Esc, assert `document.activeElement` is the button).
- Labels are verbs (the component cannot enforce this; document it in the JSDoc).

### Toast rules (UX-DR33)

- Position bottom-right, 16 px from edges, newest at the bottom, max 3 visible, FIFO queue for the rest.
- Duration 4000 ms; Radix pauses on pointer hover, focus within, and window blur; a merged duplicate restarts the timer.
- Merge key `variant|title|description`; the count badge reads "×2", with `aria-label="2 times"` (screen readers should not hear "x 2").
- Icons: success `CircleCheck` + `text-success`, warning `TriangleAlert` + `text-warning-text`, danger `CircleX` + `text-danger`, info `Info` + `text-info`. Neutral has no icon. Never `accent`.
- Radix announces toasts via its own live region (`type="foreground"` for danger, `"background"` otherwise).
- `Toaster` is mounted once (1.8 puts it in the workspace layout). This story only exports it.

### Panel resize rules

- Implemented in-house (no `react-resizable-panels`; Radix has no splitter). The handle is 4 px visible / 8 px hit area, `cursor: col-resize` (`row-resize` for bottom), accent on hover/focus/drag.
- Pointer: `setPointerCapture` on pointerdown, compute size from the start size + delta (inverted for right/bottom panels), call `onSizeChange` on every move, release on pointerup/cancel.
- Keyboard on the focused handle: ArrowLeft/Right (vertical handle) or ArrowUp/Down (horizontal) ±8 px, Shift ±32 px, Home/End = min/max, Enter = toggle collapsed.
- UX spec ranges for 1.8 callers: left panel 220–420 px; bottom panel min 120 px.

### jsdom notes

- Radix Select, Slider, Menubar and Popover call pointer-capture APIs, `scrollIntoView` and `ResizeObserver` that jsdom lacks; Task 1's polyfill file covers them.
- Prefer `userEvent.setup()` (+ `{ advanceTimers: vi.advanceTimersByTime }` with fake timers for Toast/Tooltip). Tooltip tests: `await user.hover(...)` then `findByRole("tooltip")`; Radix renders the content twice (visible + a visually hidden copy with `role="tooltip"`), so query by role.
- Radix Toast's viewport hotkey is F8 by default; test with `user.keyboard("{F8}")`.

### Keyboard/focus assertions each test must make (minimum)

| Component | Assert |
|---|---|
| IconButton | accessible name = label; `aria-keyshortcuts`; tooltip shows label + shortcut on hover and on keyboard focus; disabled reason tooltip and no click when `aria-disabled` |
| ToggleButton / ToggleGroup | Space/Enter toggles; `aria-pressed` / `data-state`; arrows rove in the group; single mode keeps one pressed |
| Toolbar | `role="toolbar"`, arrows move focus, Tab exits |
| Menu / MenuBar | Enter/Space/ArrowDown opens, arrows move, Esc closes and refocuses the trigger, Left/Right switches menus (MenuBar), disabled items skipped, `aria-keyshortcuts` on items |
| ContextMenu | right-click and Shift+F10 open; Esc closes |
| Dialog / AlertDialog | footer order, Enter = primary (and not in textarea), Esc closes, focus returns to trigger, focus trapped (Tab cycles inside) |
| Popover | opens on Enter, Esc closes, focus returns |
| Tabs | arrows + Home/End change the selected tab and panel |
| Collapsible | Enter/Space toggles `aria-expanded` and content visibility |
| Select | label association, keyboard open, arrow + Enter selects, typeahead |
| Checkbox | Space toggles, label click toggles, indeterminate state `aria-checked="mixed"` |
| NumberField | see Task 6 |
| SliderField | arrow on thumb updates the field; typing in the field moves the thumb; limits rendered |
| ColorSwatch(Group) | name, arrows rove, selected state not colour-only (check glyph present) |
| Panel | collapse button toggles `hidden`; separator arrows/Shift/Home/End change size within bounds; `aria-valuenow` updates |
| StatusBarItem | button when actionable, span otherwise; tone icon present for non-default tones |
| Toast | see Task 9 |

### Project structure notes

New files (all under `src/components/ui/` unless noted): `cx.ts`, `shortcut.ts`(+test), `tooltip.tsx`, `icon-button.tsx`, `toggle-button.tsx`, `toggle-group.tsx`, `toolbar.tsx`, `menu-styles.ts`, `menu.tsx`, `menu-bar.tsx`, `context-menu.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `popover.tsx`, `tabs.tsx`, `collapsible.tsx`, `select.tsx`, `checkbox.tsx`, `number-field.tsx`, `slider.tsx` (exports `SliderField`), `color-swatch.tsx`, `panel.tsx`, `status-bar-item.tsx`, `toast-store.ts`(+test), `toast.tsx`, each with a `.test.tsx`; `src/core/geometry/length.ts`(+test); `src/test/radix-jsdom.ts`. Modified: `button.tsx`, `text-field.tsx` (use `cx`), `eslint.config.mjs` (+ lint test).

### Previous story intelligence

- Story 1.6: flat ESLint config replaces rule options per block; repeat existing patterns when extending `no-restricted-imports`, and prove it with a lint test.
- Story 1.6: port 3020 was blocked by a Windows excluded port range; fixed on 2026-10-18 (dynamic port range restored), `npm run dev` binds 3020 again. This story needs no e2e, so no dev server is required.
- Story 1.4: contrast tests exist for token pairs. If a new pair is introduced (e.g. `text-accent-fg` on `bg-accent` for pressed toggles is already covered; check `contrast-pairs.ts`), add it there.
- Review cadence: every story gets a separate code review; keep components small and consistent so review fixes are local.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7: Foundation components]; UX-DR4, UX-DR32, UX-DR33, UX-DR34 (epics.md lines 201, 229–231)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy] (Design System Components table, Component Implementation Strategy), [#Button Hierarchy], [#Feedback Patterns], [#Form Patterns], [#Navigation Patterns], [#Keyboard Shortcuts (MVP basic set)], [#Workspace shell] (ToolRail, StatusBar, WorkspaceLayout ranges)
- [Source: _bmad-output/planning-artifacts/architecture.md] core-vs-UI boundary, units in names (`lengthMm`), coordinates in PDF points
- [Source: _bmad-output/implementation-artifacts/1-4-design-tokens-and-themes.md] tokens, Button/TextField
- [Source: _bmad-output/implementation-artifacts/1-6-security-headers-error-tracking-and-logging.md] CSP style rules, lint test pattern

## Dev Agent Record

### Agent Model Used

Claude Sonnet (BMAD dev-story workflow) for Tasks 1–9, 2026-10-18; the session was interrupted before Task 10. Claude Opus 5.5 (`claude-opus-5-5`) finished Tasks 10–11 and the fixes below, 2026-10-18.

### Debug Log References

Environment: Windows 11, Node v24.15.0.

1. Resumed with Tasks 1–9 in the working tree (uncommitted). `npm run typecheck` clean; `vitest run src/components/ui src/core/geometry` → `1 failed | 295 passed (296)`.
2. `toast.test.tsx` "F8 focuses the viewport" failed: focus stayed on `<body>`. Radix Toast matches the hotkey on `event.code`; user-event's `{F8}` does not set it. The test now dispatches `keyDown(document, { key: "F8", code: "F8" })` and asserts focus on the `<ol>` list inside the `region` labelled "Notifications (F8)" (Radix focuses the list, not the region wrapper). Component unchanged.
3. `npm run lint` → 2 errors in `dialog-shared.tsx` (`react-hooks/immutability`: a value from `useContext()` was mutated). Renamed the local to `primaryRef` so the React Compiler treats it as a ref; behaviour unchanged.
4. `tools/lint/near-sharp.test.ts` flagged `number-field.tsx: blur utility` — a false positive on the word "blur" in a doc comment. Reworded the comment.
5. Task 10: icon-package and `@radix-ui/react-*` bans added to the UI-layers `no-restricted-imports` block; `tools/lint/ui-imports.test.ts` (6 banned sources error in `src/components/`, `lucide-react` + `radix-ui` allowed). Repo grep: no existing imports of the banned packages.
6. Full `npm test` then failed once on `tools/config/next-config.test.ts` (5 s timeout on the first cold `next.config` import under load; passes alone in 4.95 s). Raised that describe's timeout to 30 s, matching the lint tests.
7. Final runs:
    - `npm run typecheck` → clean
    - `npm run lint` → no output
    - `npm test` → `Test Files 71 passed (71)`, `Tests 692 passed (692)`
    - `npm run check:pinned` → pinned
    - `npm run build` → `ƒ /`, `ƒ /_not-found`, `ƒ /pending-activation`, `ƒ /sign-in`, `ƒ /workspace`, `ƒ Proxy (Middleware)`

### Completion Notes List

- No new dependencies (Radix via `radix-ui`, `zustand/vanilla`, `lucide-react` were already installed).
- No barrel file; features import from `@/components/ui/<name>`.
- Panel is controlled; persistence is Story 1.8's job.

### File List

- Modified: `eslint.config.mjs`, `src/components/ui/button.tsx`, `src/components/ui/button.test.tsx`, `src/components/ui/text-field.tsx`, `src/components/ui/contrast-pairs.ts`, `tools/config/next-config.test.ts`
- Added (`src/components/ui/`): `cx`, `shortcut`, `tooltip`, `icon-button`, `toggle-button`, `toggle-group`, `toolbar`, `menu-styles`, `menu-parts`, `menu`, `menu-bar`, `context-menu`, `dialog-shared`, `dialog`, `alert-dialog`, `popover`, `tabs`, `collapsible`, `select`, `checkbox`, `field`, `number-field`, `slider`, `color-swatch`, `panel`, `status-bar-item`, `toast-store`, `toast` (with tests)
- Added: `src/core/geometry/length.ts`, `src/core/geometry/length.test.ts`, `src/test/radix-jsdom.ts`, `tools/lint/ui-imports.test.ts`

### Change Log

- 2026-10-18: Foundation components implemented (Story 1.7).
