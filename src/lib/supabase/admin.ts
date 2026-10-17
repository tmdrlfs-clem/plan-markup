import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types.gen";
import { getServerEnv } from "@/lib/env.server";

/**
 * Service-role client: bypasses RLS. Server-only, for narrow platform tasks
 * (rate limiting, admin operations). Never pass user input into filters
 * without validating it first.
 */
export function createAdminSupabase() {
  const env = getServerEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required on the server for sign-in rate limiting (npm run env:local for the local stack).",
    );
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
