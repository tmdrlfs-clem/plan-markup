# 0002: Pin the local Supabase Postgres image

Date: 2026-10-17
Status: accepted

## Context

Supabase CLI 2.121.0 started the local stack with `postgres:17.11.0.004`
(published 2026-10-15). With that image, schema initialisation fails before any
project migration runs:

```
ERROR 3F000 (invalid_schema_name) no schema has been selected to create in
DbSetupError: error running container: exit 1
```

It fails with an empty `supabase/migrations` folder and with realtime
excluded, so the cause is the image, not this project's SQL.
`postgres:17.6.1.155` starts cleanly and runs every migration, seed and pgTAP test.

## Decision

- `supabase/postgres-version` (tracked) holds the pinned tag.
- `scripts/pin-postgres-image.mjs` copies it to `supabase/.temp/postgres-version`
  (gitignored, read by the CLI). `db:start`, `db:reset` and `db.yml` run it first.

## Revisit

When the Supabase CLI or the Postgres image is upgraded, remove the pin, run
`npm run db:start` and `npm run db:test`, and delete the pin if they pass.
