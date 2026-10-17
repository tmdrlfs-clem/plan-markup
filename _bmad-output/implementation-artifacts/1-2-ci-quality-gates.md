# Story 1.2: CI quality gates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the founder,
I want every push checked automatically,
so that broken builds, leaked secrets and vulnerable dependencies never reach main.

## Acceptance Criteria

1. **Given** a push to `main` or a pull request on GitHub (`tmdrlfs-clem/plan-markup`, private), **when** `.github/workflows/ci.yml` runs, **then** it runs typecheck (`npm run typecheck`), ESLint (`npm run lint`), Vitest (`npm test`) and the Playwright smoke test (`npm run e2e`), and the run fails on any error.
2. A gitleaks scan fails the run on a detected secret, and a guard step fails the run if any tracked file matches `.env*` other than `.env.example` (NFR23).
3. `npm audit --omit=dev --audit-level=high` fails the run on high or critical vulnerabilities in runtime dependencies. A second step runs the full `npm audit --audit-level=high` as **report-only** (it never fails the run). A check fails the run if any `package.json` dependency uses a range (`^`, `~`, `*`, `x`, `>`, `<`, `||`, or a tag such as `latest`) (NFR33).
4. A Vitest test asserts that the lint boundaries are active: an import from `placer` into `oracle` fails lint (relative and `@/` forms). It also checks the core-purity rule (`react` in `src/core`) and `no-console`, and confirms that a clean oracle file passes.
5. The workflow status is visible on the pull request and on commits: workflow and job names are clear, and the badge is in `README.md`.
6. `.gitattributes` normalises line endings to LF, so CI on Linux and local Windows produce the same files and git no longer warns about LF→CRLF.
7. The workflow is proven on GitHub: it ran on a real push to `main` and every job finished green. The run URL is recorded in the Dev Agent Record.

## Tasks / Subtasks

- [x] **Task 1: Line endings** (AC: 6)
  - [x] Add `.gitattributes`: `* text=auto eol=lf`; mark binaries `*.png *.jpg *.jpeg *.gif *.ico *.pdf *.woff *.woff2 *.zip binary`; add `*.btx binary` (Revu tool sets are zlib/hex payloads).
  - [x] `git add --renormalize .` and review the result with `git status`. Some planning docs were written with CRLF by Python, so expect a few normalised files. Content must not change apart from line endings (`git diff --cached --ignore-cr-at-eol --stat` shows nothing for those files).
- [x] **Task 2: Pinned-version and env guards** (AC: 2, 3)
  - [x] `scripts/check-pinned.mjs` (plain Node ESM, no deps): reads `package.json` and checks `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies` if present. Every value must be an exact semver (`/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/`). It lists offenders and exits 1. Add the npm script `check:pinned`.
  - [x] `scripts/check-env-files.mjs`: runs `git ls-files`. It fails if any path's basename starts with `.env` and is not exactly `.env.example`. Add the npm script `check:env-files`.
  - [x] Unit-test both pure decision functions (export `findUnpinned(pkg)` and `findForbiddenEnvFiles(paths)`, and keep the CLI wrapper thin) in `scripts/*.test.mjs` or `.test.ts`, included by Vitest (see Task 4).
- [x] **Task 3: Lint-boundary test** (AC: 4)
  - [x] `tools/lint/boundaries.test.ts` uses the ESLint Node API (`import { ESLint } from 'eslint'`; `new ESLint({ cwd: projectRoot })`; `lintText(code, { filePath })`) against virtual file paths. Do not write files to disk.
    - `src/core/sprinkler/oracle/__probe__.ts` with `import { x } from '../placer/a'`: expect a `no-restricted-imports` error.
    - Same file with `import { x } from '@/core/sprinkler/placer/a'`: expect the same error.
    - Same file with `import { useState } from 'react'`: expect the same error. This proves the oracle block repeats the core ban.
    - `src/core/geometry/__probe__.ts` with `import React from 'react'`: expect the error. The same file using `window` should give `no-restricted-globals`.
    - `src/features/__probe__.ts` with `console.log(1)`: expect `no-console`.
    - `src/core/sprinkler/oracle/__probe__.ts` with a harmless import (`import { ptToMm } from '@/core/geometry/units'`) and use of it: expect zero errors.
  - [x] Assert on `ruleId`, not message text. Set the test timeout to about 30 s (the first ESLint load is slow).
- [x] **Task 4: Vitest include** (AC: 2, 4)
  - [x] Extend `vitest.config.mts` `test.include` with `tools/**/*.test.ts` and `scripts/**/*.test.{ts,mjs}`. Check that `tsconfig.json` and ESLint cover `tools/` and `scripts/` (lint them; they are app code, not ignored).
- [x] **Task 5: Workflow** (AC: 1, 2, 3, 5)
  - [x] Add `.nvmrc` containing `24`. Create `.github/workflows/ci.yml` following Dev Notes → Workflow shape.
  - [x] gitleaks: download the pinned binary **v8.30.1** (`gitleaks_8.30.1_linux_x64.tar.gz`) from the GitHub release. Verify it against the release's `gitleaks_8.30.1_checksums.txt` with `sha256sum --ignore-missing -c`. Then run `gitleaks git --redact --verbose --exit-code 1 .` on full history (checkout `fetch-depth: 0`; the repo is small). Do not use `gitleaks-action`; we keep control of the version and avoid its licence prompt.
  - [x] Add a `.gitleaks.toml` only if a real false positive appears, and use a narrow path or regex allowlist. Never disable a whole rule.
  - [x] Playwright: `npx playwright install --with-deps chromium`. Upload `playwright-report/` or `test-results/` as an artifact only on failure (`actions/upload-artifact@v7`, retention 7 days). Switch the reporter in CI to `[['list'], ['html', { open: 'never' }]]` so a report exists.
- [x] **Task 6: README badge** (AC: 5)
  - [x] Add the badge `![CI](https://github.com/tmdrlfs-clem/plan-markup/actions/workflows/ci.yml/badge.svg)` under the README title. On a private repo the badge only renders for signed-in collaborators; that is expected.
- [x] **Task 7: Local verification** (AC: 1–4, 6)
  - [x] Run locally: `npm run typecheck`, `npm run lint`, `npm test` (now includes boundary and guard tests), `npm run check:pinned`, `npm run check:env-files`, `npm audit --omit=dev --audit-level=high`, `npm run e2e`. Record outputs.
  - [x] Negative proofs, done locally and reverted (record outputs):
    - temporarily change one version in `package.json` to `^x.y.z`, so `check:pinned` exits 1;
    - `git add -f` a dummy `.env.test.local`, so `check:env-files` exits 1; then `git rm --cached` it and delete it;
    - if `gitleaks` is available locally (optional), run it on a temp folder holding a fake AWS key pattern to see it fail. Do not commit the fake key anywhere.
- [x] **Task 8: Prove on GitHub** (AC: 5, 7)
  - [ ] **Do not commit or push yourself.** When local checks pass, stop and report back. The orchestrator commits and pushes, then watches the run with `gh run watch`. Write in the Completion Notes exactly what the orchestrator must verify on the first run (job names, expected steps).

## Dev Notes

### Context

Story 1.1 (commit `ad9eb2d`) built the scaffold: Next 16.4.2, React 19.3.1, TypeScript 6.0.3, ESLint 9.39.5 flat config with the core-purity, oracle-independence and no-console rules, Vitest 5.0.5 (`vitest.config.mts`, `src/**/*.test.ts`), Playwright 1.64.1 (`e2e/`, Chromium, webServer `npm run dev` on port 3020, `reuseExistingServer: !process.env.CI`). Scripts: `typecheck` = `next typegen && tsc --noEmit`, `lint` = `eslint .`, `test` = `vitest run`, `e2e` = `playwright test`. Node engines `>=22.12`; this machine runs Node 24.15.0. The repo was pushed to the private GitHub repo `tmdrlfs-clem/plan-markup` on 2026-10-17. Today the founder commits straight to `main`; pull requests come later.

Out of scope: the Supabase `db.yml` workflow, migrations, schema/types drift and RLS checks (Story 1.3); the Vercel deploy (Story 8.5); Sentry (Story 1.6).

### Audit decision (from Story 1.1 follow-up)

`npm audit --omit=dev` reports 0 vulnerabilities. The full audit reports 5 high findings, all dev-only, in `braces` via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`. The advisory marks every version, so no non-breaking fix exists. The gate therefore covers runtime dependencies only. The full audit is shown in the log but does not fail the run. Do **not** add an `overrides` entry for `braces`: no patched version exists to point to. Revisit when `eslint-config-next` updates.

### Workflow shape

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
permissions: { contents: read }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  checks:            # typecheck, lint, unit tests, guards, audit
    name: Typecheck, lint, unit tests, guards
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps: checkout@v7 → setup-node@v7 (node-version-file: .nvmrc, cache: npm) → npm ci →
           check:pinned → check:env-files → typecheck → lint → test →
           npm audit --omit=dev --audit-level=high → (report-only) npm audit --audit-level=high || true
  e2e:
    name: Playwright smoke
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps: checkout → setup-node → npm ci → playwright install --with-deps chromium → npm run e2e → upload report on failure
  secrets:
    name: Secret scan (gitleaks)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: checkout (fetch-depth: 0) → download + checksum-verify gitleaks 8.30.1 → gitleaks git --redact --exit-code 1 .
```

- Pinned action majors (latest releases checked 2026-10-17): `actions/checkout@v7` (v7.0.1), `actions/setup-node@v7` (v7.1.0), `actions/upload-artifact@v7` (v7.0.2). Major tags are acceptable for first-party `actions/*`.
- `npm ci` requires the lockfile to be in sync. If it fails, fix the lockfile; never switch to `npm install` in CI.
- The `e2e` job uses `next dev` (as configured). Leave a production-server E2E for later stories.
- No secrets are needed: no job reads `.env`. Do not add repository secrets in this story.
- Keep every step's command identical to the local npm scripts, so a red CI step can be reproduced with the same command.

### ESLint API notes for the boundary test

- `new ESLint({ cwd })` picks up `eslint.config.mjs`. `lintText(code, { filePath })` applies the config blocks that match `filePath` even when the file does not exist. Use paths relative to `cwd` or absolute paths under it.
- The `eslint-config-next/typescript` preset is not type-aware (no `parserOptions.project`), so virtual files lint fine. If a typed rule ever needs a real file, the test will tell you; do not switch to disk files without recording why.
- Results: `results[0].messages[]` with `ruleId` and `severity` (2 = error).

### Project structure notes

- New folders: `.github/workflows/`, `scripts/` (repo tooling run by npm scripts and CI) and `tools/lint/` (tests about the toolchain). Both are linted and type-checked. Neither is inside `src/core`.
- English only for code, comments, workflow names and messages.
- File names kebab-case.

### Pitfalls

- Windows checkout with `core.autocrlf=true` (set globally on this machine) is the source of the LF→CRLF warnings. `.gitattributes eol=lf` overrides it per repo.
- Port 3020 zombie: before `npm run e2e` locally, check `netstat -ano | findstr ":3020"`.
- Foreground `sleep` is blocked in the agent shell. Use background runs for anything long.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: CI quality gates]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] (AR3 CI from day 1, AR24 oracle independence)
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/prd.md] (NFR23 secrets, NFR33 dependency hygiene)
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-the-app-with-the-pinned-stack.md#Completion Notes List] (audit follow-up, versions)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5 (Sonnet 5.5)

### Debug Log References

- `git add --renormalize .` changed nothing: the index already held LF content. `.gitattributes` is new and untracked (orchestrator stages it). `git ls-files --eol` shows every text file as `i/lf`.
- `npm run check:pinned` -> "All dependencies are pinned to exact versions." (exit 0)
- `npm run check:env-files` -> "No forbidden .env files are tracked." (exit 0)
- `npm run typecheck` -> "Types generated successfully", tsc clean.
- `npm run lint` -> no output, exit 0 (scripts/ and tools/ are linted).
- `npm test` -> Test Files 5 passed (5), Tests 31 passed (31). Includes 7 boundary tests, which only pass if the probes really produce the expected ruleIds.
- `npm audit --omit=dev --audit-level=high` -> "found 0 vulnerabilities", exit 0.
- `npm run e2e` -> 1 passed (8.5s); `CI=1 npm run e2e` (html reporter branch) -> 1 passed (6.6s). Port 3020 has no listener afterwards.
- Negative proof 1: `zod` changed to `^4.6.7` -> `Unpinned dependencies (exact versions only):  dependencies: zod@^4.6.7`, exit 1. package.json restored.
- Negative proof 2: `git add -f .env.test.local` -> `Tracked env files are forbidden ...  .env.test.local`, exit 1. Then `git rm --cached` and file deleted.
- gitleaks is not installed locally, so the optional local negative proof was skipped.
- AC7 run URL: pending orchestrator.

### Completion Notes List

- Tasks 1-7 done; Task 8 (commit, push, watch the run) belongs to the orchestrator.
- Task 1: `.gitattributes` added; renormalisation found no files to change, as the committed blobs were already LF.
- Playwright reporter switched to list + html only when `CI` is set (local output unchanged).
- `.gitleaks.toml` not added (no false positive known yet). gitleaks job downloads v8.30.1 and verifies it against the release checksums file.
- Orchestrator must check on the first GitHub run: three jobs named "Typecheck, lint, unit tests, guards", "Playwright smoke" and "Secret scan (gitleaks)" all green. In the first, the report-only step "Audit all dependencies (report only)" prints 5 dev-only high findings but is green. In the secrets job, "Install gitleaks (checksum verified)" must print `gitleaks_8.30.1_linux_x64.tar.gz: OK`, and the scan must find no leaks in the full history (if it flags an old planning doc, add a narrow path allowlist). Check that `npm ci` passes on Node 24 and that Playwright installs Chromium. Check the README badge URL resolves to the workflow and that git no longer warns about LF->CRLF. Record the run URL under AC7.

- AC7 verified by the orchestrator (Opus, 2026-10-17): push of `fb8af14` to `main` triggered run https://github.com/tmdrlfs-clem/plan-markup/actions/runs/38996006239, conclusion `success`. Jobs: "Typecheck, lint, unit tests, guards" success (31 tests passed; runtime audit 0 vulnerabilities; report-only audit printed the 5 known dev-only highs and stayed green), "Playwright smoke" success (1 passed), "Secret scan (gitleaks)" success (`gitleaks_8.30.1_linux_x64.tar.gz: OK`, 4 commits scanned, no leaks found).
- Orchestrator local re-run before push: check:pinned, check:env-files, typecheck, lint, 31 Vitest tests, runtime audit and Playwright smoke all pass.

### File List

- .gitattributes (new)
- .nvmrc (new)
- .github/workflows/ci.yml (new)
- scripts/check-pinned.mjs (new)
- scripts/check-env-files.mjs (new)
- scripts/check-pinned.test.mjs (new)
- scripts/check-env-files.test.mjs (new)
- tools/lint/boundaries.test.ts (new)
- package.json (check:pinned, check:env-files scripts)
- vitest.config.mts (include tools and scripts tests)
- playwright.config.ts (CI html reporter)
- README.md (CI badge)
- _bmad-output/implementation-artifacts/sprint-status.yaml (story -> review)
- _bmad-output/implementation-artifacts/1-2-ci-quality-gates.md

### Change Log

- 2026-10-17: Implemented CI quality gates (workflow, guards, boundary tests, line-ending policy, badge).
