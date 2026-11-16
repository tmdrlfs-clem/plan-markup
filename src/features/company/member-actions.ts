"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getCompanyAdmin } from "./guard";

// Story 10.7: a company admin changes roles and removes members. Each write
// is one database transaction that checks the actor again, ends the member's
// sessions and writes audit_log; it refuses to leave the company without an
// active admin.

const RoleSchema = z.strictObject({
  userId: z.uuid({ error: "Choose a member." }),
  role: z.enum(["admin", "member", "viewer"], { error: "Choose a role." }),
});

const RemoveSchema = z.strictObject({ userId: z.uuid({ error: "Choose a member." }) });

const LAST_ADMIN = "A company needs at least one active admin. Make someone else an admin first.";
const NOT_A_MEMBER = "This person is no longer a member of your company.";

export type MemberChange = {
  /** True when the admin changed their own membership: their session has ended. */
  self: boolean;
};

export async function changeMemberRole(
  input: unknown,
): Promise<Result<MemberChange & { role: "admin" | "member" | "viewer"; changed: boolean }>> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = RoleSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  const { userId, role } = parsed.data;
  try {
    const { data, error } = await createAdminSupabase().rpc("set_company_member_role", {
      p_actor_id: admin.user.id,
      p_user_id: userId,
      p_role: role,
    });
    if (error) {
      revalidatePath("/company/members");
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fail("NOT_FOUND", NOT_A_MEMBER);
      if (error.code === "PT409") return fail("CONFLICT", LAST_ADMIN);
      return internalError("company.set_role_failed", new Error(`set_company_member_role failed: ${error.code ?? "unknown"}`));
    }
    const previous = data?.[0]?.previous_role;
    if (previous === undefined) return internalError("company.set_role_failed", new Error("set_company_member_role returned no row"));
    revalidatePath("/company/members");
    const changed = previous !== role;
    return { ok: true, data: { role, changed, self: changed && userId === admin.user.id } };
  } catch (error) {
    return internalError("company.set_role_failed", error);
  }
}

export async function removeMember(input: unknown): Promise<Result<MemberChange>> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  const { userId } = parsed.data;
  try {
    const { error } = await createAdminSupabase().rpc("remove_company_member", { p_actor_id: admin.user.id, p_user_id: userId });
    if (error) {
      revalidatePath("/company/members");
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fail("NOT_FOUND", NOT_A_MEMBER);
      if (error.code === "PT409") return fail("CONFLICT", LAST_ADMIN);
      return internalError("company.remove_member_failed", new Error(`remove_company_member failed: ${error.code ?? "unknown"}`));
    }
    revalidatePath("/company/members");
    return { ok: true, data: { self: userId === admin.user.id } };
  } catch (error) {
    return internalError("company.remove_member_failed", error);
  }
}
