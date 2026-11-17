"use server";

import { revalidatePath } from "next/cache";

import { companyUseMapSchema } from "@/core/sprinkler/use-map";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getCompanyAdmin } from "./guard";

// Story 10.12 (FR72): a company admin edits their company's use → hazard
// mapping. Each write is one database transaction that checks the actor again,
// replaces the whole mapping and writes audit_log (what it was, what it is).

const PATH = "/company/4541";

export type UseMapSaved = {
  /** False when the mapping already was what was sent: nothing was written. */
  changed: boolean;
  /** The mapping's version; null when the company is back on the platform default. */
  version: string | null;
};

/** A refusal that belongs to one row of the form (`uses.<index>.use`) or to the default choice. */
export type UseMapResult = Result<UseMapSaved> & { field?: string };

async function write(actorId: string, uses: { use: string; hazard: string; is_default: boolean }[] | null): Promise<UseMapResult> {
  const { data, error } = await createAdminSupabase().rpc("set_company_use_hazard_map", { p_actor_id: actorId, p_uses: uses });
  if (error) {
    revalidatePath(PATH);
    if (error.code === "PT403") return fail("FORBIDDEN");
    // The database's own checks (the form and the schema above normally refuse these first).
    if (error.code === "22023" || error.code === "23514" || error.code === "23505") return fail("INVALID_INPUT", "Check the mapping: each use once, with a valid name and hazard class.");
    return internalError("company.use_map_failed", new Error(`set_company_use_hazard_map failed: ${error.code ?? "unknown"}`));
  }
  const row = data?.[0];
  if (!row) return internalError("company.use_map_failed", new Error("set_company_use_hazard_map returned no row"));
  revalidatePath(PATH);
  return { ok: true, data: { changed: row.changed, version: row.map_version } };
}

/** Saves `{ defaultUse, uses: [{ use, hazard }] }` as the company's mapping. */
export async function saveCompanyUseMap(input: unknown): Promise<UseMapResult> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = companyUseMapSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ...fail("INVALID_INPUT", issue?.message ?? "Check the mapping."), field: issue?.path.join(".") };
  }
  const { defaultUse, uses } = parsed.data;
  try {
    return await write(
      admin.user.id,
      uses.map((u) => ({ use: u.use, hazard: u.hazard, is_default: u.use === defaultUse })),
    );
  } catch (error) {
    return internalError("company.use_map_failed", error);
  }
}

/** Removes the company's own mapping: its new zones follow the platform default again. */
export async function resetCompanyUseMap(): Promise<UseMapResult> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  try {
    return await write(admin.user.id, null);
  } catch (error) {
    return internalError("company.use_map_failed", error);
  }
}
