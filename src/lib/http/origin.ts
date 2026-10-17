// CSRF guard for state-changing route handlers (NFR29). Pure: Web Request/Headers only.
// Server actions use Next.js's built-in Origin/Host check instead.
import { SAFE_MESSAGES } from "@/lib/result";

/**
 * Hosts accepted besides the request's own host. Mirrors
 * serverActions.allowedOrigins in next.config.ts (unset: same-origin only).
 */
export const EXTRA_ALLOWED_HOSTS: readonly string[] = [];

const MAX_ORIGIN_LENGTH = 2048;

/**
 * True when the Origin header's host equals the request host (the first
 * X-Forwarded-Host entry, else Host), or one of `extraHosts`. A missing,
 * "null", over-long, malformed or non-http(s) Origin is rejected: browsers
 * always send Origin on POST/PUT/PATCH/DELETE. A future webhook route that
 * cannot send Origin must be exempted explicitly in review, never by
 * weakening this check.
 */
export function isAllowedOrigin(headers: Headers, extraHosts: readonly string[] = EXTRA_ALLOWED_HOSTS): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null" || origin.length > MAX_ORIGIN_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const originHost = url.host.toLowerCase();
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expected = (forwarded || headers.get("host"))?.trim().toLowerCase();
  if (expected && originHost === expected) return true;
  return extraHosts.some((host) => host.toLowerCase() === originHost);
}

/** Wraps a route handler: a disallowed Origin gets 403 with a fixed FORBIDDEN body. */
export function withOriginCheck<Ctx>(
  handler: (request: Request, ctx: Ctx) => Response | Promise<Response>,
): (request: Request, ctx: Ctx) => Promise<Response> {
  return async (request, ctx) =>
    isAllowedOrigin(request.headers)
      ? handler(request, ctx)
      : Response.json({ ok: false, code: "FORBIDDEN", message: SAFE_MESSAGES.FORBIDDEN }, { status: 403 });
}
