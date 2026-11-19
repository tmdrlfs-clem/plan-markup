import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { classifyUpdateError, type SetPasswordFailure } from "./password-reset";
import { classifyAuthError } from "./sign-in";

// Changing the password while signed in (Settings → Account). The current
// password is checked by signing in with it on a separate client that keeps
// no session, so this request's session is untouched. The new password is
// then set through the admin API: Supabase's own update would ask a session
// older than 24 hours to re-authenticate by email ("Secure password change"),
// and the current password already proves who is asking.

export type CurrentPasswordCheck = "ok" | "wrong" | "rate_limited" | "unavailable";

/** Signs in with the current password on a throwaway client, then ends that session. */
export async function checkCurrentPassword(email: string, current: string): Promise<CurrentPasswordCheck> {
  const env = getServerEnv();
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: current });
  if (error) {
    const reason = classifyAuthError(error);
    if (reason === "rate_limited") return "rate_limited";
    if (reason === "unavailable") {
      logger.error("auth.current_password_check_failed", { status: error.status, code: error.code });
      return "unavailable";
    }
    return "wrong";
  }
  const { error: outError } = await client.auth.signOut({ scope: "local" });
  if (outError) logger.warn("auth.current_password_session_not_ended", { status: outError.status, code: outError.code });
  return "ok";
}

/**
 * Sets the user's new password, then ends every other session of theirs
 * (NFR17). This session stays signed in.
 */
export async function replacePassword(userId: string, password: string): Promise<{ ok: true } | { ok: false; reason: SetPasswordFailure }> {
  const { error } = await createAdminSupabase().auth.admin.updateUserById(userId, { password });
  if (error) {
    const reason = classifyUpdateError(error);
    if (reason === "unavailable") logger.error("auth.password_change_failed", { status: error.status, code: error.code });
    return { ok: false, reason };
  }
  const supabase = await createServerSupabase();
  const { error: outError } = await supabase.auth.signOut({ scope: "others" });
  if (outError) {
    // The password changed; the other sessions still end when their tokens next refresh fails.
    logger.error("auth.sign_out_others_failed", { status: outError.status, code: outError.code });
  }
  return { ok: true };
}
