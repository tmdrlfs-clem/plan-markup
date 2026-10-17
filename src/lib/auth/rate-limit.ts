import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { rateLimitKeyHash } from "./rate-limit-key";

/** Sign-in limits (NFR15, founder decision 2026-10-18). */
export const SIGN_IN_LIMITS = {
  sign_in_ip: { maxHits: 30, windowSeconds: 900 },
  sign_in_email: { maxHits: 10, windowSeconds: 900 },
} as const;

export type RateLimitBucket = keyof typeof SIGN_IN_LIMITS;

export type ConsumeArgs = {
  bucket: RateLimitBucket;
  keyHash: string;
  maxHits: number;
  windowSeconds: number;
};

export type ConsumeResult = { allowed: boolean; retryAfterSeconds: number };

export type Consume = (args: ConsumeArgs) => Promise<ConsumeResult>;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Counts one hit through public.consume_rate_limit (service role). Throws on any error. */
export const rpcConsume: Consume = async ({ bucket, keyHash, maxHits, windowSeconds }) => {
  const { data, error } = await createAdminSupabase().rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_key_hash: keyHash,
    p_max_hits: maxHits,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`consume_rate_limit failed: ${error.code ?? "unknown"}`);
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row || typeof row.allowed !== "boolean") {
    throw new Error("consume_rate_limit returned no row");
  }
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
};

/**
 * Consumes one sign-in attempt for the client IP and one for the normalised
 * email. Every attempt counts, successful or not. Fails closed: rejects when
 * the limiter cannot be reached.
 */
export async function checkSignInRateLimit(
  { ip, email }: { ip: string; email: string },
  consume: Consume = rpcConsume,
): Promise<RateLimitDecision> {
  const normalisedEmail = email.trim().toLowerCase();
  const results = await Promise.all([
    consume({
      bucket: "sign_in_ip",
      keyHash: rateLimitKeyHash("sign_in_ip", ip),
      ...SIGN_IN_LIMITS.sign_in_ip,
    }),
    consume({
      bucket: "sign_in_email",
      keyHash: rateLimitKeyHash("sign_in_email", normalisedEmail),
      ...SIGN_IN_LIMITS.sign_in_email,
    }),
  ]);
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length === 0) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)),
  };
}
