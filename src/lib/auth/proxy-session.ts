// Session refresh for src/proxy.ts. Not server-only: the proxy is not part of
// the React Server Components bundle. The only raw getUser() outside get-auth-user.ts.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/types.gen";
import { getPublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS, withAuthCookieOptions } from "@/lib/supabase/cookie-options";

export type SessionResult = { response: NextResponse; isAuthenticated: boolean };

/**
 * Refreshes the Supabase session cookies and reports whether the request has
 * a verified user. Does not check profiles.status: pages and actions do (AC 9).
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({ request });
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = getPublicEnv();
  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, withAuthCookieOptions(options));
        }
        // Cache-Control: no-store and friends, so a CDN never caches a session.
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Do not run code between createServerClient and getUser(): it refreshes the session.
  const { data } = await supabase.auth.getUser();
  return { response, isAuthenticated: Boolean(data.user) };
}
