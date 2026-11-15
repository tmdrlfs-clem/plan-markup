"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAdmin } from "@/lib/auth";
import { mailConfig, sendMail, type MailOutcome } from "@/lib/email/mailer";
import { YOU_ARE_IN_SUBJECT, youAreInMail } from "@/lib/email/templates";
import { logger } from "@/lib/logger";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Story 10.4: the platform admin activates and deactivates accounts. The
// status changes in one database transaction (public.admin_set_user_status)
// that checks the actor again, ends the user's sessions on deactivation and
// writes audit_log. The service client is used for that call only.

const SetStatusSchema = z.strictObject({
  userId: z.uuid({ error: "Choose an account." }),
  status: z.enum(["active", "deactivated"], { error: "Choose a status." }),
});

export type SetUserStatusData = {
  status: "active" | "deactivated";
  /** False when the account already had this status (nothing was written). */
  changed: boolean;
  /** Set when an account was activated: whether the "You're in" email went out. */
  mail?: MailOutcome;
};

export async function setUserStatus(input: unknown): Promise<Result<SetUserStatusData>> {
  const admin = await getPlatformAdmin();
  // An ordinary user learns nothing about the admin actions.
  if (!admin) return fail("FORBIDDEN");
  const parsed = SetStatusSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Check the request.");
  const { userId, status } = parsed.data;
  if (userId === admin.id && status === "deactivated") {
    return fail("CONFLICT", "You can't deactivate your own account.");
  }

  let previous: { previous_status: string; email: string; name: string };
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_set_user_status", {
      p_actor_id: admin.id,
      p_user_id: userId,
      p_status: status,
    });
    if (error) {
      if (error.code === "PT404") return fail("NOT_FOUND", "This account no longer exists.");
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT409") return fail("CONFLICT", "You can't deactivate your own account.");
      return internalError("admin.set_user_status_failed", new Error(`admin_set_user_status failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.set_user_status_failed", new Error("admin_set_user_status returned no row"));
    previous = row;
  } catch (error) {
    return internalError("admin.set_user_status_failed", error);
  }

  const changed = previous.previous_status !== status;
  let mail: MailOutcome | undefined;
  if (changed && status === "active") {
    const config = mailConfig();
    if (config) {
      mail = await sendMail({ to: previous.email, ...youAreInMail({ name: previous.name, appUrl: config.appUrl }) }, { config });
    } else {
      // The account is active all the same; the admin is told no email went out.
      logger.warn("mail.not_configured", { subject: YOU_ARE_IN_SUBJECT });
      mail = "not_configured";
    }
  }
  if (changed) logger.info("admin.user_status_changed", { status, mail });
  revalidatePath("/admin/users");
  return { ok: true, data: { status, changed, ...(mail ? { mail } : {}) } };
}
