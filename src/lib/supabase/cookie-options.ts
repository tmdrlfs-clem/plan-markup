import type { CookieOptions } from "@supabase/ssr";

/** Session lifetime cap in seconds (30 days), matching `[auth.sessions] timebox` (NFR17). */
export const AUTH_COOKIE_MAX_AGE = 2_592_000;

/**
 * Cookie options for the Supabase session cookies (AC 1). HttpOnly, so no
 * browser Supabase client can read the session (see Story 1.5 Dev Notes).
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: AUTH_COOKIE_MAX_AGE,
} as const satisfies CookieOptions;

/**
 * @supabase/ssr 0.12.7 always replaces `maxAge` with its own 400-day default
 * when it writes a session cookie, whatever `cookieOptions` says. Apply our
 * flags on every write and cap the lifetime; removals (maxAge 0) stay removals.
 */
export function withAuthCookieOptions(options: CookieOptions | undefined): CookieOptions {
  const maxAge = options?.maxAge;
  return {
    ...options,
    httpOnly: AUTH_COOKIE_OPTIONS.httpOnly,
    secure: AUTH_COOKIE_OPTIONS.secure,
    sameSite: AUTH_COOKIE_OPTIONS.sameSite,
    path: AUTH_COOKIE_OPTIONS.path,
    maxAge:
      maxAge === undefined ? AUTH_COOKIE_MAX_AGE : Math.min(maxAge, AUTH_COOKIE_MAX_AGE),
  };
}
