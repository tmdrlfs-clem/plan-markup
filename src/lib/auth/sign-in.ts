import "server-only";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

export type SignInFailure = "invalid" | "rate_limited" | "unavailable";

export type SignInOutcome = { ok: true } | { ok: false; reason: SignInFailure };

type AuthErrorLike = { status?: number; code?: string };

/** Maps a Supabase Auth error to a reason. No detail goes upward (NFR16). */
export function classifyAuthError(error: AuthErrorLike): SignInFailure {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rate_limited";
  if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
    return "invalid";
  }
  return "unavailable";
}

/** Signs in with email and password. On success the session cookies are set on this response. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInOutcome> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return { ok: true };
  const reason = classifyAuthError(error);
  if (reason === "unavailable") {
    // Status and code only: never the email, the password or the message.
    logger.error("auth.sign_in_upstream_failed", { status: error.status, code: error.code });
  }
  return { ok: false, reason };
}

/** Ends the current session on the Auth server and clears the session cookies. */
export async function signOutCurrentSession(): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    logger.warn("auth.sign_out_failed", { status: error.status, code: error.code });
  }
}
