import pg from "pg";

export const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

/** Clears the sign-in rate-limit counters so reruns are not throttled. */
export default async function globalSetup(): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error("Local Supabase is not running (npm run db:start)", { cause: error });
  }
  try {
    await client.query("delete from app.rate_limits");
  } finally {
    await client.end();
  }
}
