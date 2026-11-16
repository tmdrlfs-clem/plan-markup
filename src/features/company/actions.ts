"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkInviteRateLimit } from "@/lib/auth/rate-limit";
import { mailConfig, sendMail } from "@/lib/email/mailer";
import { inviteMail } from "@/lib/email/templates";
import { invitePath, newInviteToken } from "@/lib/invite-token";
import { logger } from "@/lib/logger";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getCompanyAdmin } from "./guard";

// Story 10.6: a company admin invites people by email and withdraws
// invitations. Each write is one database transaction that checks the actor
// again and writes audit_log. The emailed link carries a random token; only
// its hash is stored.

const InviteSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address.")
    .max(254, "Enter a valid email address.")
    .pipe(z.email({ error: "Enter a valid email address." })),
  role: z.enum(["admin", "member", "viewer"], { error: "Choose a role." }),
});

const RevokeSchema = z.strictObject({ invitationId: z.uuid({ error: "Choose an invitation." }) });

const INVITE_MAIL_FAILED = "The invitation email could not be sent, so no invitation was made. Try again shortly.";

/** A refusal that belongs to the email field of the form. */
export type InviteResult = Result<{ email: string }> & { field?: "email" };

function emailError(code: "INVALID_INPUT" | "CONFLICT", message: string): InviteResult {
  return { ...fail(code, message), field: "email" };
}

export async function inviteMember(input: unknown): Promise<InviteResult> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return issue?.path[0] === "email" ? emailError("INVALID_INPUT", issue.message) : fail("INVALID_INPUT", issue?.message ?? "Check the request.");
  }
  const { email, role } = parsed.data;

  // Without mail settings an invitation could never arrive: refuse before making one.
  const config = mailConfig();
  if (!config) {
    logger.warn("mail.not_configured", { subject: "company invitation" });
    return fail("INTERNAL", INVITE_MAIL_FAILED);
  }

  try {
    const decision = await checkInviteRateLimit(admin.user.id);
    if (!decision.allowed) return fail("RATE_LIMITED", "Too many invitations. Try again in an hour.");

    const { token, hash } = newInviteToken();
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.rpc("create_company_invitation", {
      p_actor_id: admin.user.id,
      p_email: email,
      p_role: role,
      p_token_hash: hash,
    });
    if (error) {
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT409") return emailError("CONFLICT", "This person is already a member of your company.");
      if (error.code === "PT423") return emailError("CONFLICT", "This person already belongs to another company. They must leave it before they can join yours.");
      return internalError("company.invite_failed", new Error(`create_company_invitation failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("company.invite_failed", new Error("create_company_invitation returned no row"));

    const outcome = await sendMail(
      {
        to: email,
        ...inviteMail({ companyName: row.company_name, inviterName: admin.user.name, role, link: `${config.appUrl}${invitePath(token)}` }),
      },
      { config },
    );
    if (outcome !== "sent") {
      // Nobody holds the link: withdraw the invitation so the list shows only ones that went out.
      const { error: revokeError } = await supabase.rpc("revoke_company_invitation", {
        p_actor_id: admin.user.id,
        p_invitation_id: row.invitation_id,
      });
      if (revokeError) logger.error("company.invite_cleanup_failed", { code: revokeError.code });
      revalidatePath("/company/members");
      return fail("INTERNAL", INVITE_MAIL_FAILED);
    }
    revalidatePath("/company/members");
    return { ok: true, data: { email } };
  } catch (error) {
    return internalError("company.invite_failed", error);
  }
}

export async function revokeInvitation(input: unknown): Promise<Result<{ invitationId: string }>> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  const { invitationId } = parsed.data;
  try {
    const { error } = await createAdminSupabase().rpc("revoke_company_invitation", {
      p_actor_id: admin.user.id,
      p_invitation_id: invitationId,
    });
    if (error) {
      revalidatePath("/company/members");
      if (error.code === "PT404") return fail("NOT_FOUND", "This invitation no longer exists.");
      if (error.code === "PT409") return fail("CONFLICT", "This invitation was already accepted or withdrawn.");
      return internalError("company.revoke_invitation_failed", new Error(`revoke_company_invitation failed: ${error.code ?? "unknown"}`));
    }
    revalidatePath("/company/members");
    return { ok: true, data: { invitationId } };
  } catch (error) {
    return internalError("company.revoke_invitation_failed", error);
  }
}
