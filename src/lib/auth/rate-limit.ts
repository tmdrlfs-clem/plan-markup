import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { rateLimitKeyHash } from "./rate-limit-key";

/** Sign-in limits (NFR15, founder decision 2026-10-18). */
export const SIGN_IN_LIMITS = {
  sign_in_ip: { maxHits: 30, windowSeconds: 900 },
  sign_in_email: { maxHits: 10, windowSeconds: 900 },
} as const;

/** Sign-up limits (Story 10.1, NFR15): per IP and per email, one hour. */
export const SIGN_UP_LIMITS = {
  sign_up_ip: { maxHits: 10, windowSeconds: 3600 },
  sign_up_email: { maxHits: 5, windowSeconds: 3600 },
} as const;

/** Password-reset requests (Story 10.2, NFR15): per IP and per email, one hour. */
export const RESET_LIMITS = {
  reset_ip: { maxHits: 10, windowSeconds: 3600 },
  reset_email: { maxHits: 3, windowSeconds: 3600 },
} as const;

/** Email changes per signed-in user (Story 10.3): each sends two emails. */
export const EMAIL_CHANGE_LIMITS = {
  email_change_user: { maxHits: 5, windowSeconds: 3600 },
} as const;

/** Password changes per signed-in user: each checks the current password. */
export const PASSWORD_CHANGE_LIMITS = {
  password_change_user: { maxHits: 5, windowSeconds: 900 },
} as const;

/** Company invitations per inviting user (Story 10.6): each sends one email. */
export const INVITE_LIMITS = {
  invite_user: { maxHits: 20, windowSeconds: 3600 },
} as const;

export type RateLimitBucket =
  | keyof typeof SIGN_IN_LIMITS
  | keyof typeof SIGN_UP_LIMITS
  | keyof typeof RESET_LIMITS
  | keyof typeof EMAIL_CHANGE_LIMITS
  | keyof typeof PASSWORD_CHANGE_LIMITS
  | keyof typeof INVITE_LIMITS;

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
  return checkPair(SIGN_IN_LIMITS, "sign_in_ip", "sign_in_email", ip, email, consume);
}

/** Sign-up attempts, per IP and per email (Story 10.1). Same rules as sign-in. */
export async function checkSignUpRateLimit(
  { ip, email }: { ip: string; email: string },
  consume: Consume = rpcConsume,
): Promise<RateLimitDecision> {
  return checkPair(SIGN_UP_LIMITS, "sign_up_ip", "sign_up_email", ip, email, consume);
}

/** Password-reset requests, per IP and per email (Story 10.2). */
export async function checkResetRateLimit(
  { ip, email }: { ip: string; email: string },
  consume: Consume = rpcConsume,
): Promise<RateLimitDecision> {
  return checkPair(RESET_LIMITS, "reset_ip", "reset_email", ip, email, consume);
}

/** Email changes of one user (Story 10.3). Fails closed: throws when the limiter cannot be reached. */
export async function checkEmailChangeRateLimit(userId: string, consume: Consume = rpcConsume): Promise<RateLimitDecision> {
  const r = await consume({
    bucket: "email_change_user",
    keyHash: rateLimitKeyHash("email_change_user", userId),
    ...EMAIL_CHANGE_LIMITS.email_change_user,
  });
  return r.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: r.retryAfterSeconds };
}

/** Password changes of one user: limits guesses of the current password. Fails closed. */
export async function checkPasswordChangeRateLimit(userId: string, consume: Consume = rpcConsume): Promise<RateLimitDecision> {
  const r = await consume({
    bucket: "password_change_user",
    keyHash: rateLimitKeyHash("password_change_user", userId),
    ...PASSWORD_CHANGE_LIMITS.password_change_user,
  });
  return r.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: r.retryAfterSeconds };
}

/** Invitations sent by one user (Story 10.6). Fails closed: throws when the limiter cannot be reached. */
export async function checkInviteRateLimit(userId: string, consume: Consume = rpcConsume): Promise<RateLimitDecision> {
  const r = await consume({
    bucket: "invite_user",
    keyHash: rateLimitKeyHash("invite_user", userId),
    ...INVITE_LIMITS.invite_user,
  });
  return r.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: r.retryAfterSeconds };
}

async function checkPair<I extends RateLimitBucket, E extends RateLimitBucket>(
  limits: Record<I | E, { maxHits: number; windowSeconds: number }>,
  ipBucket: I,
  emailBucket: E,
  ip: string,
  email: string,
  consume: Consume,
): Promise<RateLimitDecision> {
  const normalisedEmail = email.trim().toLowerCase();
  const results = await Promise.all([
    consume({ bucket: ipBucket, keyHash: rateLimitKeyHash(ipBucket, ip), ...limits[ipBucket] }),
    consume({
      bucket: emailBucket,
      keyHash: rateLimitKeyHash(emailBucket, normalisedEmail),
      ...limits[emailBucket],
    }),
  ]);
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length === 0) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)),
  };
}
