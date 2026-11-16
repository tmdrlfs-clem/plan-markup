"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAdmin } from "@/lib/auth";
import type { Plan } from "@/lib/plans";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Story 10.8: the platform admin sets the plan of a company or an individual
// account. One database transaction (public.admin_set_plan) checks the actor
// again, saves the plan and writes audit_log. There is no other way to change
// a plan: users have no write access to either column (NFR24).

const SetPlanSchema = z.strictObject({
  targetType: z.enum(["user", "company"], { error: "Choose an account or a company." }),
  targetId: z.uuid({ error: "Choose an account or a company." }),
  plan: z.enum(["trial", "pilot", "standard"], { error: "Choose a plan." }),
});

export async function setPlan(input: unknown): Promise<Result<{ plan: Plan; changed: boolean }>> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = SetPlanSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  const { targetType, targetId, plan } = parsed.data;
  const path = targetType === "user" ? "/admin/users" : "/admin/companies";
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_set_plan", {
      p_actor_id: admin.id,
      p_target_type: targetType,
      p_target_id: targetId,
      p_plan: plan,
    });
    if (error) {
      revalidatePath(path);
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") {
        return fail("NOT_FOUND", targetType === "user" ? "This account no longer exists." : "This company no longer exists.");
      }
      return internalError("admin.set_plan_failed", new Error(`admin_set_plan failed: ${error.code ?? "unknown"}`));
    }
    const previous = data?.[0]?.previous_plan;
    if (previous === undefined) return internalError("admin.set_plan_failed", new Error("admin_set_plan returned no row"));
    revalidatePath(path);
    return { ok: true, data: { plan, changed: previous !== plan } };
  } catch (error) {
    return internalError("admin.set_plan_failed", error);
  }
}
