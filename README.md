# Plan Markup

Web-based PDF plan markup for fire protection work, with an NZS 4541 sprinkler placement engine. Built with Next.js 16, React 19, Supabase and PDF.js.

## Commands

- `npm run dev` - dev server on http://localhost:3020
- `npm run build` / `npm start` - production build and server (port 3020)
- `npm run typecheck` - TypeScript check
- `npm run lint` - ESLint (includes the `src/core` and 4541 oracle boundaries)
- `npm test` - Vitest unit tests
- `npm run e2e` - Playwright smoke tests (starts the dev server; run `npx playwright install chromium` once)

Copy `.env.example` to `.env.local` and fill it in before using Supabase features.

## Documents

- Planning artifacts (PRD, architecture, UX, epics): `_bmad-output/planning-artifacts/`
- Project docs and decisions: `docs/`
