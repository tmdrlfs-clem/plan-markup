import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/types.gen";
import { getPublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS, withAuthCookieOptions } from "./cookie-options";

/**
 * A user-scoped Supabase client bound to this request's cookies (RLS applies).
 * Creates a new client per call: never share one across requests.
 * Use getAuthUser()/getAuthState() from @/lib/auth to identify the user.
 */
export async function createServerSupabase() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = getPublicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, withAuthCookieOptions(options));
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so a skipped write here is harmless.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;
