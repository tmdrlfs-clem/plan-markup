import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy-session";

/**
 * Paths reachable without a session (exact match). Everything else the matcher
 * covers is protected (default-deny). The marketing site (Epic 13) adds its
 * paths here or excludes them in the matcher.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", "/sign-in"]);

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

/**
 * Refreshes the session on every matched request and sends anonymous requests
 * on protected paths to /sign-in. Only checks "is there a verified user":
 * pages, actions and route handlers check profiles.status themselves (NFR13).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { response, isAuthenticated } = await updateSession(request);

  if (!isAuthenticated && !isPublicPath(request.nextUrl.pathname)) {
    return redirectToSignIn(request, response);
  }

  // Story 1.6 adds the nonce-based CSP and security headers here.
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
