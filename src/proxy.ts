import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy-session";
import { getPublicEnv } from "@/lib/env";
import { buildNonceCsp, buildStaticCsp, generateNonce } from "@/lib/security/csp";
import { applyStaticSecurityHeaders } from "@/lib/security/headers";
import { cspModeFor } from "@/lib/security/route-policy";

/**
 * Paths reachable without a session (exact match). Everything else the matcher
 * covers is protected (default-deny). The marketing site (Epic 13) adds its
 * paths here or excludes them in the matcher.
 */
// Story 8.5: /api/health is the uptime monitor's check (no session, nothing secret).
// Story 10.1: /sign-up and the email confirmation link; 10.2: /forgot-password;
// 10.3: /email-change (the result of an email-change link, possibly opened elsewhere).
// 10.6: /invite (an emailed company invitation, opened before signing in or up).
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/auth/confirm",
  "/email-change",
  "/invite",
  "/api/health",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function redirectToSignIn(request: NextRequest, refreshed: NextResponse): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = "/sign-in";
  target.search = "";
  if (request.method === "GET" || request.method === "HEAD") {
    const { pathname, search } = request.nextUrl;
    target.searchParams.set("next", pathname + search);
  }
  const redirect = NextResponse.redirect(target);
  // Keep any refreshed session cookies, or a refresh would be lost.
  for (const cookie of refreshed.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

function cspFor(request: NextRequest): { csp: string; nonce: string | null } {
  const env = getPublicEnv();
  const isDev = process.env.NODE_ENV === "development";
  const common = {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
    isDev,
  };
  if (cspModeFor(request.nextUrl.pathname) === "static") {
    // Fail closed until Story 13.1 supplies the hash manifest: no inline script runs.
    return { csp: buildStaticCsp({ ...common, scriptHashes: [] }), nonce: null };
  }
  const nonce = generateNonce();
  return { csp: buildNonceCsp({ ...common, nonce, devHost: request.nextUrl.host }), nonce };
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  applyStaticSecurityHeaders(response.headers);
  return response;
}

/**
 * Sets the per-request CSP (NFR28), refreshes the session on every matched
 * request and sends anonymous requests on protected paths to /sign-in. Only
 * checks "is there a verified user": pages, actions and route handlers check
 * profiles.status themselves (NFR13).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { csp, nonce } = cspFor(request);

  // Next.js reads the nonce from the *request* CSP header while rendering.
  // set() (never append) so client-sent values are overwritten; the
  // report-only header is dropped because Next also reads a nonce from it.
  request.headers.set("content-security-policy", csp);
  request.headers.delete("content-security-policy-report-only");
  if (nonce) request.headers.set("x-nonce", nonce);
  else request.headers.delete("x-nonce");

  // updateSession builds NextResponse.next({ request }), which forwards the
  // request headers set above to rendering.
  const { response, isAuthenticated } = await updateSession(request);

  const result =
    !isAuthenticated && !isPublicPath(request.nextUrl.pathname)
      ? redirectToSignIn(request, response)
      : response;
  return withSecurityHeaders(result, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|pdfjs/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
