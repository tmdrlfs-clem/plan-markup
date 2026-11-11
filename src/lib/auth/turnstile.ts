import "server-only";
import { logger } from "@/lib/logger";

/** Cloudflare's server-side check for a Turnstile token. */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome = "passed" | "failed" | "unavailable" | "skipped";

type Fetch = typeof fetch;

/**
 * Whether Turnstile must be checked. It is checked whenever a secret is set,
 * and the production deployment (VERCEL_ENV=production) must set one: without
 * it sign-up fails closed there. Local dev, CI and e2e run without it.
 */
export function turnstileRequired(env: Record<string, string | undefined> = process.env): {
  secret: string | null;
  required: boolean;
} {
  const secret = env.TURNSTILE_SECRET_KEY || null;
  return { secret, required: secret !== null || env.VERCEL_ENV === "production" };
}

/**
 * Verifies a Turnstile token (Story 10.1, NFR14). Tokens are single-use, so
 * the form gets a fresh widget after every submit.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  { env = process.env, fetchImpl = fetch }: { env?: Record<string, string | undefined>; fetchImpl?: Fetch } = {},
): Promise<TurnstileOutcome> {
  const { secret, required } = turnstileRequired(env);
  if (!required) return "skipped";
  if (!secret) {
    logger.error("auth.turnstile_secret_missing");
    return "unavailable";
  }
  if (!token || token.length > 2048) return "failed";
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.error("auth.turnstile_upstream_failed", { status: res.status });
      return "unavailable";
    }
    const data = (await res.json()) as { success?: unknown };
    return data.success === true ? "passed" : "failed";
  } catch (error) {
    logger.error("auth.turnstile_upstream_failed", { error: error instanceof Error ? error : null });
    return "unavailable";
  }
}
