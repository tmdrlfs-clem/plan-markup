// Copies the pinned Postgres image tag from supabase/postgres-version into
// supabase/.temp/postgres-version, which the Supabase CLI reads at start.
// Without it CLI 2.121.0 pulls postgres 17.11.0.004, whose schema init fails
// ("no schema has been selected to create in"). See docs/decisions/0002.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const version = readFileSync("supabase/postgres-version", "utf8").trim();
mkdirSync("supabase/.temp", { recursive: true });
writeFileSync("supabase/.temp/postgres-version", version, "utf8");
process.stdout.write(`Pinned Supabase Postgres image to ${version}\n`);
