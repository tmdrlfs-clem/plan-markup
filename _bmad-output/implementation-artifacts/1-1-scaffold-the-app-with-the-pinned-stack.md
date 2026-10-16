# Story 1.1: Scaffold the app with the pinned stack

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the founder,
I want the Plan Markup app scaffolded at the repo root with the agreed stack and boundaries,
so that every later story builds on the same versions, structure and rules.

## Acceptance Criteria

1. **Given** the `plan-markup/` folder already holds `docs/`, `_bmad-output/`, `_bmad/`, `.claude/`, `spikes/`, `.gitignore` and an initialised git repo (`main`, no commits), **when** `create-next-app` is run into `plan-markup-app/` and its files are moved to the repo root, **then** `npm run dev` serves the default page on port **3020** and every existing folder and file is untouched (except `.gitignore`, which is merged).
2. Runtime and dev dependencies are installed at the **exact** versions listed in Dev Notes → Pinned versions (no `^` or `~` in `package.json`; `.npmrc` has `save-exact=true`), and the TypeScript version decision is recorded in `docs/decisions/0001-typescript-version.md`.
3. The folder skeleton exists: `src/{core,workers,features,components/ui,lib}`, `supabase/`, `fixtures/{pdf,btx,zones,private}`, `e2e/`. Empty folders carry a `.gitkeep`. `fixtures/private/` and `.env*.local` are git-ignored.
4. ESLint (flat config, `eslint.config.mjs`):
   - forbids React / Next / Supabase imports and DOM globals in `src/core/**`;
   - forbids `src/core/sprinkler/oracle/**` importing `src/core/sprinkler/placer/**` (relative and `@/` paths);
   - forbids `console.*` everywhere in `src/**` and `e2e/**` except `src/lib/logger.ts`.
5. `src/lib/env.ts` validates the required environment with Zod v4, and `.env.example` lists every variable it reads.
6. Vitest runs at least one sample test in `src/core` (`npm test` exits 0), and Playwright runs one smoke test against the dev server (`npm run e2e` exits 0).
7. `npm run typecheck`, `npm run lint` and `npm run build` all exit 0.

## Tasks / Subtasks

- [ ] **Task 1: Scaffold and move to root** (AC: 1)
  - [ ] From `plan-markup/`, run (non-interactive; flags verified against create-next-app 16.4.2 `--help`):
        `npx create-next-app@16.4.2 plan-markup-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --no-react-compiler --no-agent-feedback --yes`
        - `--turbopack` from the architecture text **no longer exists** (Turbopack is the default in Next 16). Do not pass it.
        - `--disable-git` is required: the repo root already has `.git`; a nested repo inside `plan-markup-app/` would break the move.
        - If `--no-react-compiler` is rejected as unknown, drop it and answer "No" (or rely on `--yes` defaults), then confirm `next.config.ts` does not enable `reactCompiler`.
  - [ ] Move every file from `plan-markup-app/` to the root, **including dotfiles** (`.gitignore`). Do not overwrite existing root items. Expected scaffold files: `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `next-env.d.ts`, `README.md`, `AGENTS.md` (and `CLAUDE.md` if generated), `public/`, `src/app/`, `node_modules/`.
  - [ ] **Merge** the scaffold `.gitignore` into the existing root `.gitignore` (keep every existing root line, add any missing scaffold lines such as `/.next/`, `next-env.d.ts`, `*.tsbuildinfo`, `.vercel`). Add `fixtures/private/`.
  - [ ] Delete the then-empty `plan-markup-app/` folder. Confirm `docs/`, `_bmad/`, `_bmad-output/`, `.claude/`, `spikes/` have no changes (`git status` shows them only as untracked, unchanged content).
  - [ ] Moving `node_modules` across folders on Windows can fail on long paths or locked files. If it does, delete `plan-markup-app/node_modules` and run `npm ci` at the root instead.
  - [ ] Replace `README.md` with a short English project README: what the app is, `npm run dev` (port 3020), test commands, and links to `_bmad-output/planning-artifacts/` and `docs/`.
- [ ] **Task 2: Pin dependencies** (AC: 2)
  - [ ] Create `.npmrc` with `save-exact=true`.
  - [ ] Install runtime deps exactly: `npm i -E @supabase/supabase-js@2.118.0 @supabase/ssr@0.12.7 zod@4.6.7 pdfjs-dist@6.4.299 @cantoo/pdf-lib@2.11.1 zustand@5.0.15 flatbush@4.6.2 rbush@4.0.1 idb@8.0.4 @sentry/nextjs@11.8.0 radix-ui@1.8.1 lucide-react@1.58.0`
  - [ ] Install dev deps exactly: `npm i -D -E vitest@5.0.5 @playwright/test@1.64.1 supabase@2.121.0`
  - [ ] Rewrite every scaffold range in `package.json` to an exact version (`next 16.4.2`, `react`/`react-dom 19.3.1`, `tailwindcss`/`@tailwindcss/postcss 4.3.3`, `eslint-config-next 16.4.2`, `@types/*`, `eslint`, `typescript`). Run `npm i` to refresh the lockfile.
  - [ ] **TypeScript decision** (see Dev Notes → TypeScript): pin `typescript@6.0.3` unless you prove 7.0.2 works with `next build`, `eslint-config-next` (typescript-eslint) and Vitest. Write `docs/decisions/0001-typescript-version.md` (context, versions tried, commands run, result, decision, when to revisit).
  - [ ] **ESLint major**: keep ESLint **9.x** (pin `9.39.5` or whatever exact 9.x the scaffold installed). ESLint 10 breaks peer ranges of `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y` used by `eslint-config-next`. Never use `--force` or `--legacy-peer-deps` to hide a conflict.
  - [ ] Add a `"engines": { "node": ">=20.9" }` field.
  - [ ] Check: `grep -E '"\^|"~' package.json` returns nothing.
- [ ] **Task 3: Scripts and port** (AC: 1, 6, 7)
  - [ ] `package.json` scripts: `dev: next dev -p 3020`, `build: next build`, `start: next start -p 3020`, `lint: eslint .`, `typecheck: tsc --noEmit`, `test: vitest run`, `test:watch: vitest`, `e2e: playwright test`. (`next lint` was removed in Next 16; call ESLint directly.)
  - [ ] Set `metadata.title` in `src/app/layout.tsx` to `"Plan Markup"`. Leave the default page body otherwise as generated (Story 1.4 replaces styling, Story 1.8 the shell).
  - [ ] Ignore non-app folders everywhere: ESLint `ignores` and `tsconfig.json` `exclude` must cover `spikes/**`, `_bmad/**`, `_bmad-output/**`, `.claude/**`, `fixtures/**`, `playwright-report/**`, `test-results/**`. The spike keeps its own `node test/run.mjs` and must not be type-checked or linted by the app.
- [ ] **Task 4: Folder skeleton** (AC: 3)
  - [ ] Create `src/core/`, `src/workers/`, `src/features/`, `src/components/ui/`, `src/lib/`, `supabase/`, `fixtures/pdf/`, `fixtures/btx/`, `fixtures/zones/`, `fixtures/private/`, `e2e/`. Put a `.gitkeep` in each folder that is still empty when the story ends (not in `fixtures/private/`, which is ignored).
  - [ ] Add `fixtures/README.md`: what each folder is for; `private/` holds the founder's real drawings and `.btx` files and is never committed.
  - [ ] Do **not** run `supabase init` here. Story 1.3 owns `supabase/config.toml`, custom ports and migrations. The CLI is only installed now.
- [ ] **Task 5: ESLint boundaries** (AC: 4)
  - [ ] Extend the generated `eslint.config.mjs` (keep `eslint-config-next` core-web-vitals + typescript presets). Write the rules from Dev Notes → ESLint rules.
  - [ ] Create `src/lib/logger.ts` (`logger.debug/info/warn/error`, level from `NEXT_PUBLIC_LOG_LEVEL` with default `info` in production and `debug` otherwise). It is the only file allowed to call `console.*`.
  - [ ] Prove each rule by hand with throwaway files (delete them afterwards). Record the lint output in Debug Log References:
        `src/core/_probe.ts` importing `react` → error; using `window` → error;
        `src/core/sprinkler/oracle/_probe.ts` importing `../placer/_x` and `@/core/sprinkler/placer/_x` → error;
        `src/features/_probe.ts` with `console.log` → error.
        (Story 1.2 turns the oracle probe into a permanent CI test. Do not add it here.)
- [ ] **Task 6: Validated env** (AC: 5)
  - [ ] Create `src/lib/env.ts` per Dev Notes → Env.
  - [ ] Create `.env.example` listing every variable with a comment and a safe placeholder. Do not create `.env.local`. If one is needed to run locally, it stays ignored.
  - [ ] Add `src/lib/env.test.ts`: valid input parses; missing `NEXT_PUBLIC_SUPABASE_URL` fails with a message naming the variable; a non-URL fails.
- [ ] **Task 7: Vitest** (AC: 6)
  - [ ] `vitest.config.ts`: `test.include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`, `test.environment: 'node'` (React component tests add jsdom in Story 1.7), alias `@` → `./src` (via `resolve.alias` with `fileURLToPath(new URL('./src', import.meta.url))`).
  - [ ] Sample core module `src/core/geometry/units.ts` exporting `PT_PER_INCH = 72`, `MM_PER_INCH = 25.4`, `ptToMm(pt)` and `mmToPt(mm)`. It is real (AR8: geometry is stored in PDF points; mm only at display) and later stories build on it.
  - [ ] `src/core/geometry/units.test.ts`: 72 pt = 25.4 mm; round-trip within 1e-9; 0 → 0; negative values allowed.
- [ ] **Task 8: Playwright smoke** (AC: 6)
  - [ ] `playwright.config.ts`: `testDir: 'e2e'`, Chromium project only, `baseURL: 'http://localhost:3020'`, `webServer: { command: 'npm run dev', url: 'http://localhost:3020', reuseExistingServer: !process.env.CI, timeout: 120_000 }`.
  - [ ] `npx playwright install chromium` (once per machine; Story 1.2 does it in CI).
  - [ ] `e2e/smoke.spec.ts`: `GET /` returns 200 and the page title is `Plan Markup`.
- [ ] **Task 9: Final verification** (AC: 1–7)
  - [ ] Run in order and record results: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`, and `npm run dev` + open `http://localhost:3020`.
  - [ ] Re-run `node spikes/4541-placement/test/run.mjs` to prove the spike still works (exit 0).
  - [ ] `git status` review: no `.env*.local`, no `node_modules`, no `.next`, no `fixtures/private` content staged or shown. **Do not commit**: the founder commits only on request.

## Dev Notes

### Context

First story of the project. The repo root already contains planning artifacts and a working 4541 spike; nothing in them may change. Git was initialised on 2026-10-17 (`main`, repo-local author `seunggil <tmdrlfss@gmail.com>`, no commits). A root `.gitignore` already exists and must be merged, not replaced.

This story only builds the base: versions, folders and lint boundaries that later stories rely on. Out of scope: Supabase init and ports (1.3), CI workflow and oracle-lint CI test (1.2), tokens, themes and fonts (1.4), auth and `proxy.ts` (1.5), CSP and Sentry wiring (1.6). Install `@sentry/nextjs` but do **not** run the Sentry wizard or add `instrumentation.ts`.

### Pinned versions (verified with `npm view` on 2026-10-17)

| Package | Exact version | Notes |
|---|---|---|
| next / eslint-config-next / create-next-app | 16.4.2 | |
| react / react-dom | 19.3.1 | `@types/react` / `@types/react-dom` 19.3.0 |
| typescript | **6.0.3** (default decision) | 7.0.2 is latest but see below |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | |
| eslint | **9.39.5** (latest 9.x) | 10.13.0 is latest but breaks plugin peers |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7 | wired in 1.3 / 1.5 |
| zod | 4.6.7 | |
| pdfjs-dist | 6.4.299 | |
| @cantoo/pdf-lib | 2.11.1 | maintained fork; never install `pdf-lib` |
| zustand | 5.0.15 | |
| flatbush / rbush / idb | 4.6.2 / 4.0.1 / 8.0.4 | |
| @sentry/nextjs | 11.8.0 | install only |
| radix-ui / lucide-react | 1.8.1 / 1.58.0 | |
| vitest / @playwright/test | 5.0.5 / 1.64.1 | |
| supabase (CLI, dev dep) | 2.121.0 | |
| @types/node | as scaffolded, pinned exact | Node on this machine: v24.15.0, npm 11.12.1 |

### TypeScript: why 6.0.3 is the default

`typescript-eslint@8.71.2` (pulled in by `eslint-config-next@16.4.2`) declares peer `typescript >=4.8.4 <6.1.0`. TypeScript 7 is the native (Go) compiler and does not provide the JS compiler API that typed lint rules use, so typed ESLint will fail or warn on 7.0.2. The architecture allows falling back: "TypeScript 7.0.2 — pin latest 6.x/5.x if Next/ESLint/Vitest are incompatible (decided in story 1)". You may try 7.0.2 first in a few minutes. If `npm i` reports a peer conflict, or lint or build fails, pin 6.0.3 and record the evidence. Revisit when typescript-eslint supports 7.

### ESLint rules (flat config)

ESLint flat config does **not merge** options for the same rule across blocks: a later block that sets `no-restricted-imports` replaces the earlier one for the files it matches. The oracle block must therefore repeat the core restrictions as well as adding the placer ban.

```js
// eslint.config.mjs — shape, adapt to the generated file
const CORE_BANNED = {
  paths: [
    { name: 'react', message: 'src/core must stay framework-free.' },
    { name: 'react-dom', message: 'src/core must stay framework-free.' },
  ],
  patterns: [
    { group: ['react/*', 'react-dom/*', 'next', 'next/*', '@supabase/*', '@/features/*', '@/components/*', '@/lib/*', '@/app/*', '@/workers/*'],
      message: 'src/core must stay framework-free and import nothing from app layers.' },
  ],
};
const PLACER_BAN = {
  group: ['**/placer', '**/placer/*', '@/core/sprinkler/placer', '@/core/sprinkler/placer/*'],
  message: 'The 4541 oracle must stay independent of the placer.',
};

export default [
  // ...existing next presets,
  { ignores: ['spikes/**', '_bmad/**', '_bmad-output/**', '.claude/**', 'fixtures/**', '.next/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
  { files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'], rules: { 'no-console': 'error' } },
  { files: ['src/lib/logger.ts'], rules: { 'no-console': 'off' } },
  { files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', CORE_BANNED],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'sessionStorage', 'location'],
    } },
  { files: ['src/core/sprinkler/oracle/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: CORE_BANNED.paths, patterns: [...CORE_BANNED.patterns, PLACER_BAN] }] } },
];
```

- `src/core` runs in Web Workers too, so `self`, `navigator`, `crypto`, `performance` and `OffscreenCanvas` stay allowed. Only page-DOM globals are banned.
- Raw `supabase.auth.getSession()` / `getUser()` bans come in Story 1.5 (AR4). Do not add them here.
- Keep `no-console` as `error`, not `warn`. CI in 1.2 fails on it.

### Env (`src/lib/env.ts`)

- Variables now: `NEXT_PUBLIC_SUPABASE_URL` (url, required), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (non-empty, required), `SUPABASE_SERVICE_ROLE_KEY` (optional, server only), `NEXT_PUBLIC_SENTRY_DSN` (optional url), `SENTRY_AUTH_TOKEN` (optional, build only), `NEXT_PUBLIC_LOG_LEVEL` (optional enum `debug|info|warn|error`).
- Export a pure `parseEnv(source: Record<string, string | undefined>)` that returns the parsed object or throws one error listing **every** invalid variable by name. Also export a lazily validated `getPublicEnv()` / `getServerEnv()` pair. Validate on first call, not at module import, so the default page and `next build` still work before Supabase exists (Story 1.3).
- Next.js inlines `NEXT_PUBLIC_*` only when referenced **literally** (`process.env.NEXT_PUBLIC_SUPABASE_URL`). Build the source object with literal property reads. Never pass `process.env` itself or index it dynamically on the client.
- `getServerEnv()` must never be imported by client components. Add `import 'server-only'` to a separate `src/lib/env.server.ts` if you split it. (`server-only` comes with Next; if it is not resolvable, install the exact latest version.)
- Zod v4: use `z.url()` / `z.string().min(1)`. Error messages are in English.

### Project structure notes

- Matches architecture "Complete Project Directory Structure" (`_bmad-output/planning-artifacts/architecture.md` §Project Structure & Boundaries). Root configs only. Tests are co-located (`foo.ts` + `foo.test.ts`). E2E tests live in `e2e/`.
- File names `kebab-case.ts`; no `I` prefix on types; units in names (`lengthPt`, `lengthMm`).
- All code, comments, docs and messages in **English** (the BMAD config says Korean output; the founder's English-only product rule overrides it).
- Variance from the architecture text: drop `--turbopack` (the flag no longer exists); add `--disable-git`; pin ESLint 9 and TypeScript 6.0.3 (pending the recorded decision). Port 3020: other local projects use 3000 and 3010.
- `AGENTS.md` from the scaffold tells agents to read `node_modules/next/dist/docs/` before writing Next code. Keep it, because Next 16 APIs differ from model training data (e.g. `src/proxy.ts` instead of `middleware.ts`).

### Testing standards

- Vitest for pure `src/core` and `src/lib` logic. Tests import the shipped module, never a copy.
- Playwright for E2E against `next dev` on 3020, Chromium only for now.
- Every AC is checked by a command whose output goes in Debug Log References. Do not mark a task done without running its command.

### Known pitfalls from earlier projects

- Windows: a zombie `node` process can hold a port and cause odd 404s. Check with `netstat -ano | findstr ":3020"`, then `Stop-Process -Id <PID> -Force`.
- Do not create `middleware.ts`. Next 16 uses `src/proxy.ts` (Story 1.5).
- Python and some tools on Windows write CRLF line endings. Keep generated files as the scaffold made them; do not mass-convert.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Scaffold the app with the pinned stack]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] (starter command, versions, AR1, AR2, AR16, AR24)
- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: docs/4541-placement-design.md] (oracle independence)
- [Source: spikes/4541-placement/README.md] (spike must keep running)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
