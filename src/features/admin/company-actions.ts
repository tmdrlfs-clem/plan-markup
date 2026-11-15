"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Story 10.5: the platform admin creates a company with its first admin. One
// database transaction (public.admin_create_company) checks the actor again,
// creates the company and the membership and writes audit_log.

const CreateCompanySchema = z.strictObject({
  name: z.string().trim().min(1, "Enter the company's name.").max(100, "Use at most 100 characters."),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter the first admin's email.")
    .max(254, "Enter a valid email address.")
    .pipe(z.email({ error: "Enter a valid email address." })),
});

export type CreateCompanyField = "name" | "adminEmail";

/** A refusal that belongs to one field of the form. */
export type CreateCompanyResult = Result<{ id: string; name: string }> & { field?: CreateCompanyField };

function fieldError(field: CreateCompanyField, code: "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND", message: string): CreateCompanyResult {
  return { ...fail(code, message), field };
}

export async function createCompany(input: unknown): Promise<CreateCompanyResult> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = CreateCompanySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === "name" || issue?.path[0] === "adminEmail" ? issue.path[0] : undefined;
    return { ...fail("INVALID_INPUT", field ? issue.message : "Check the request."), ...(field ? { field } : {}) };
  }
  const { name, adminEmail } = parsed.data;

  try {
    const { data, error } = await createAdminSupabase().rpc("admin_create_company", {
      p_actor_id: admin.id,
      p_name: name,
      p_admin_email: adminEmail,
    });
    if (error) {
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fieldError("adminEmail", "NOT_FOUND", "No account has this email. Ask them to sign up first.");
      if (error.code === "PT422") return fieldError("adminEmail", "CONFLICT", "This account is not active. Activate it under Accounts first.");
      if (error.code === "PT409") return fieldError("adminEmail", "CONFLICT", "This person already belongs to a company.");
      if (error.code === "23505") return fieldError("name", "CONFLICT", "A company with this name already exists.");
      return internalError("admin.create_company_failed", new Error(`admin_create_company failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.create_company_failed", new Error("admin_create_company returned no row"));
    logger.info("admin.company_created", {});
    revalidatePath("/admin/companies");
    return { ok: true, data: { id: row.company_id, name } };
  } catch (error) {
    return internalError("admin.create_company_failed", error);
  }
}
