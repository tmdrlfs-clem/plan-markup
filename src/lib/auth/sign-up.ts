import "server-only";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

export type SignUpFailure = "weak_password" | "invalid_email" | "rate_limited" | "unavailable";

export type SignUpOutcome = { ok: true } | { ok: false; reason: SignUpFailure };

type AuthErrorLike = { status?: number; code?: string };

/**
 * Maps a Supabase Auth sign-up error to a reason. An existing email is never
 * an error the caller sees (NFR16): with confirmations on, Auth answers as if
 * it were new, and "user_already_exists" is treated as success just in case.
 */
export function classifySignUpError(error: AuthErrorLike): SignUpFailure | "ok" {
  if (error.code === "user_already_exists" || error.code === "email_exists") return "ok";
  if (error.code === "weak_password") return "weak_password";
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "invalid_email";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  return "unavailable";
}

/**
 * Creates the auth user; Auth emails the confirmation link and the profile
 * starts as `pending` (app.fn_handle_new_user). No session is created until the
 * email is confirmed.
 */
export async function signUpWithPassword(email: string, password: string): Promise<SignUpOutcome> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({ email, password });
  if (!error) return { ok: true };
  const reason = classifySignUpError(error);
  if (reason === "ok") return { ok: true };
  if (reason === "unavailable") {
    logger.error("auth.sign_up_upstream_failed", { status: error.status, code: error.code });
  }
  return { ok: false, reason };
}
