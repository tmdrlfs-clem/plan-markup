"use server";

import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { checkEmailChangeRateLimit } from "@/lib/auth/rate-limit";
import { logger } from "@/lib/logger";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 10.3: Settings → Account. Only the name is written to the profile (its
// column grant allows name and theme only); the email changes through Auth,
// confirmed on both addresses, and a trigger copies it to the profile. Status,
// role, company, plan and the admin flag have no endpoint here (NFR24).

const NameSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Use at most 100 characters."),
});

const EmailSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your new email address.")
    .max(254, "Enter a valid email address.")
    .pipe(z.email({ error: "Enter a valid email address." })),
});

/** Sets the signed-in user's display name (the author on their markups). */
export async function updateName(input: unknown): Promise<Result<{ name: string }>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = NameSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Check your name.");
  const { name } = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("profiles").update({ name }).eq("id", user.id).select("name");
    if (error) return internalError("account.update_name_failed", new Error(`profiles update failed: ${error.code ?? "unknown"}`));
    if (!data || data.length !== 1) return fail("NOT_FOUND");
    return { ok: true, data: { name } };
  } catch (error) {
    return internalError("account.update_name_failed", error);
  }
}

/**
 * Starts an email change: Auth sends a confirmation link to the current and
 * the new address; the email changes once both are opened. Rate-limited per
 * user. The answer does not say whether the new address is taken (NFR16).
 */
export async function changeEmail(input: unknown): Promise<Result<{ email: string }>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = EmailSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Enter a valid email address.");
  const { email } = parsed.data;
  if (email === user.email.toLowerCase()) return fail("INVALID_INPUT", "That is already your email.");
  try {
    const decision = await checkEmailChangeRateLimit(user.id);
    if (!decision.allowed) return fail("RATE_LIMITED", "Too many email changes. Try again in an hour.");
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.updateUser({ email });
    if (error) {
      // An address already in use is answered like any other (no enumeration).
      if (error.code === "email_exists" || error.code === "user_already_exists") return { ok: true, data: { email } };
      if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        return fail("RATE_LIMITED", "Too many emails sent. Try again in an hour.");
      }
      if (error.code === "email_address_invalid" || error.code === "validation_failed") {
        return fail("INVALID_INPUT", "Enter a valid email address.");
      }
      logger.error("account.change_email_failed", { status: error.status, code: error.code });
      return fail("INTERNAL");
    }
    return { ok: true, data: { email } };
  } catch (error) {
    return internalError("account.change_email_failed", error);
  }
}
