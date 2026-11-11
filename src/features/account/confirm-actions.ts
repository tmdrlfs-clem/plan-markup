"use server";

import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";
import { landing, parseLink } from "./confirm-link";

// The links in our emails (sign-up confirmation 10.1, password reset 10.2,
// email change 10.3) open /auth/confirm, which only shows a button. The token
// is used here, on the button's POST (security review 2026-11-12):
//   - mail scanners and link previews open links with GET, and would use up a
//     single-use token before the user got to it;
//   - a GET that signs in lets someone else's link sign a person in by merely
//     being loaded (login CSRF). A server action is same-origin only.

/** Uses the emailed token: confirms, signs in, and goes where that kind of link leads. */
export async function confirmLink(formData: FormData): Promise<void> {
  const link = parseLink({ token_hash: formData.get("token_hash"), type: formData.get("type") });
  if (!link) redirect("/sign-in?link=invalid");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  if (error) {
    logger.warn("auth.confirm_failed", { status: error.status, code: error.code });
    redirect("/sign-in?link=invalid");
  }
  // The first of the two email-change links answers without a user (Auth's "proceed to the
  // other email"); the second returns the user with the new email.
  redirect(landing(link.type, !data.user || Boolean(data.user.new_email)));
}
