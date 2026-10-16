# 0001 - TypeScript version

Date: 2026-10-17
Status: Accepted

## Context

The architecture lists TypeScript 7.0.2 (the native Go compiler) but allows pinning the latest 6.x/5.x if Next, ESLint or Vitest are incompatible. `create-next-app@16.4.2` scaffolds `typescript@^5`. `eslint-config-next@16.4.2` pulls in `typescript-eslint@8.71.2`, which declares the peer range `typescript >=4.8.4 <6.1.0`.

## Versions tried and commands run

- Scaffold default: `typescript@5.9.3`.
- `npm i -D -E typescript@7.0.2 --dry-run`: npm printed repeated `ERESOLVE overriding peer dependency` warnings and planned to re-add `typescript-eslint@8.71.2` against TypeScript 7.0.2. That resolution violates the declared peer range `<6.1.0`. It is accepted only by overriding the peer check, which the project forbids (`--force` and `--legacy-peer-deps` are never used).
- TypeScript 7 also does not ship the JavaScript compiler API that typed lint rules in `typescript-eslint` rely on.
- `typescript@6.0.3` (inside the supported range) was installed. Results with it: `npm run typecheck`, `npm run lint`, `npm test` (Vitest 5.0.5) and `npm run build` (Next 16.4.2) all run clean (see the Debug Log in Story 1.1).

## Decision

Pin `typescript@6.0.3` exactly.

## Revisit when

`typescript-eslint` (via `eslint-config-next`) declares support for TypeScript 7, or `eslint-config-next` drops the dependency. Then retry 7.x and re-run typecheck, lint, test and build.
