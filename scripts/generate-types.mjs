// Writes src/lib/db/types.gen.ts from the local database (LF line endings).
// Needs the local stack: npm run db:start.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateTypes, TYPES_PATH } from "./check-types-drift.mjs";

mkdirSync(dirname(TYPES_PATH), { recursive: true });
writeFileSync(TYPES_PATH, generateTypes(), "utf8");
process.stdout.write(`Wrote ${TYPES_PATH}\n`);
