import "server-only";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

/** How long after opening the reset link the new password may be set (the link itself lasts 1 h). */
export const RECOVERY_WINDOW_SECONDS = 3600;

type AuthErrorLike = { status?: number; code?: string };

/** Asks Auth to email a reset link. Auth answers the same for unknown emails (NFR16). */
export async function requestPasswordReset(email: string): Promise<"ok" | "rate_limited" | "unavailable"> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (!error) return "ok";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  // Unknown emails are not errors; anything else is the service.
  logger.error("auth.reset_request_failed", { status: error.status, code: error.code });
  return "unavailable";
}

type Amr = { method?: unknown; timestamp?: unknown };

/**
 * Sign-in methods that prove the user just opened a link sent to their email.
 * Auth records a token-hash reset link as "otp" (checked locally, 2026-11-12);
 * "recovery" is the older name. The app has no other OTP or magic-link sign-in,
 * so "otp" only comes from our emailed links (reset, or sign-up confirmation).
 */
const EMAIL_LINK_METHODS = new Set(["otp", "recovery"]);

/** True when the session's methods include an emailed-link sign-in no older than the window. Pure, for tests. */
export function hasFreshRecovery(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some(
    (a: Amr) =>
      typeof a?.method === "string" &&
      EMAIL_LINK_METHODS.has(a.method) &&
      typeof a.timestamp === "number" &&
      nowSeconds - a.timestamp <= RECOVERY_WINDOW_SECONDS &&
      a.timestamp <= nowSeconds + 60,
  );
}

/**
 * Whether this request's session came from a reset link, recently (verified
 * claims). /reset-password only lets such a session set a password without the
 * current one, so a session that was merely left open cannot.
 */
export async function sessionCameFromRecovery(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  return hasFreshRecovery((data.claims as { amr?: unknown }).amr, Math.floor(Date.now() / 1000));
}

export type SetPasswordFailure = "same_password" | "weak_password" | "unavailable";

export function classifyUpdateError(error: AuthErrorLike): SetPasswordFailure {
  if (error.code === "same_password") return "same_password";
  if (error.code === "weak_password") return "weak_password";
  return "unavailable";
}

/**
 * Sets the new password, then ends every other session of the user (NFR17).
 * This session stays signed in.
 */
export async function setNewPassword(password: string): Promise<{ ok: true } | { ok: false; reason: SetPasswordFailure }> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const reason = classifyUpdateError(error);
    if (reason === "unavailable") logger.error("auth.password_update_failed", { status: error.status, code: error.code });
    return { ok: false, reason };
  }
  const { error: outError } = await supabase.auth.signOut({ scope: "others" });
  if (outError) {
    // The password changed; the other sessions still end when their tokens next refresh fails.
    logger.error("auth.sign_out_others_failed", { status: outError.status, code: outError.code });
  }
  return { ok: true };
}
