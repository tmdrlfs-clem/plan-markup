"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { RULESET_ID, ruleFiguresInputSchema } from "@/core/sprinkler/rules/rules";
import { companyUseMapSchema } from "@/core/sprinkler/use-map";
import type { UseMapResult } from "@/features/company/use-map-actions";
import { getPlatformAdmin } from "@/lib/auth";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Story 10.13 (FR79, A7, NFR34): the platform admin maintains the rule figures
// and the platform default use → hazard mapping. Each write is one database
// transaction that checks the actor again and writes audit_log.
//
// Rule figures: an edit adds the next version as a draft (used by nobody);
// confirming the newest version puts it in use. Versions are never changed.
// The default mapping: replaced as a whole (a draft again), then confirmed.

const PATH = "/admin/rules";

const versionSchema = z.strictObject({ version: z.string().regex(/^[0-9]{1,6}$/) });

export type RuleFiguresSaved = {
  /** False when the figures already were the newest version's: nothing was written. */
  changed: boolean;
  /** The newest version's number. */
  version: string;
};

/** A refusal that belongs to one figure of the form (`hazards.ELH.Amax`) or to the source. */
export type RuleFiguresResult = Result<RuleFiguresSaved> & { field?: string };

/** Adds `{ hazards, source }` as the next version of the rule figures: a draft until it is confirmed. */
export async function saveRuleFigures(input: unknown): Promise<RuleFiguresResult> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = ruleFiguresInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ...fail("INVALID_INPUT", issue?.message ?? "Check the figures."), field: issue?.path.join(".") };
  }
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_create_rule_figures", {
      p_actor_id: admin.id,
      p_ruleset_id: RULESET_ID,
      p_hazards: parsed.data.hazards,
      p_source: parsed.data.source,
    });
    if (error) {
      revalidatePath(PATH);
      if (error.code === "PT403") return fail("FORBIDDEN");
      // The database's own checks (the form and the schema above normally refuse these first).
      if (error.code === "22023") return fail("INVALID_INPUT", "Check the figures: each a number in its range, each minimum below its maximum.");
      return internalError("admin.rule_figures_failed", new Error(`admin_create_rule_figures failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.rule_figures_failed", new Error("admin_create_rule_figures returned no row"));
    revalidatePath(PATH);
    return { ok: true, data: { changed: row.changed, version: row.version } };
  } catch (error) {
    return internalError("admin.rule_figures_failed", error);
  }
}

/** Confirms the newest version of the rule figures: from then on placements and checks use it. */
export async function confirmRuleFigures(input: unknown): Promise<Result<{ changed: boolean }>> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_verify_rule_figures", {
      p_actor_id: admin.id,
      p_ruleset_id: RULESET_ID,
      p_version: parsed.data.version,
    });
    if (error) {
      revalidatePath(PATH);
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fail("NOT_FOUND", "This version no longer exists.");
      if (error.code === "PT409") return fail("CONFLICT", "A newer version has been added since. Check it before confirming.");
      return internalError("admin.rule_figures_failed", new Error(`admin_verify_rule_figures failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.rule_figures_failed", new Error("admin_verify_rule_figures returned no row"));
    revalidatePath(PATH);
    return { ok: true, data: { changed: row.changed } };
  } catch (error) {
    return internalError("admin.rule_figures_failed", error);
  }
}

/** Saves `{ defaultUse, uses: [{ use, hazard }] }` as the platform default mapping: a draft until it is confirmed. */
export async function saveDefaultUseMap(input: unknown): Promise<UseMapResult> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = companyUseMapSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ...fail("INVALID_INPUT", issue?.message ?? "Check the mapping."), field: issue?.path.join(".") };
  }
  const { defaultUse, uses } = parsed.data;
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_set_default_use_hazard_map", {
      p_actor_id: admin.id,
      p_uses: uses.map((u) => ({ use: u.use, hazard: u.hazard, is_default: u.use === defaultUse })),
    });
    if (error) {
      revalidatePath(PATH);
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "22023" || error.code === "23514" || error.code === "23505") return fail("INVALID_INPUT", "Check the mapping: each use once, with a valid name and hazard class.");
      return internalError("admin.default_use_map_failed", new Error(`admin_set_default_use_hazard_map failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.default_use_map_failed", new Error("admin_set_default_use_hazard_map returned no row"));
    revalidatePath(PATH);
    return { ok: true, data: { changed: row.changed, version: row.map_version } };
  } catch (error) {
    return internalError("admin.default_use_map_failed", error);
  }
}

/** Marks the platform default mapping (the version the admin looked at) as verified. */
export async function confirmDefaultUseMap(input: unknown): Promise<Result<{ changed: boolean }>> {
  const admin = await getPlatformAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Check the request.");
  try {
    const { data, error } = await createAdminSupabase().rpc("admin_verify_default_use_hazard_map", {
      p_actor_id: admin.id,
      p_version: parsed.data.version,
    });
    if (error) {
      revalidatePath(PATH);
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fail("NOT_FOUND", "There is no default mapping.");
      if (error.code === "PT409") return fail("CONFLICT", "The mapping has changed since. Check it before confirming.");
      return internalError("admin.default_use_map_failed", new Error(`admin_verify_default_use_hazard_map failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("admin.default_use_map_failed", new Error("admin_verify_default_use_hazard_map returned no row"));
    revalidatePath(PATH);
    return { ok: true, data: { changed: row.changed } };
  } catch (error) {
    return internalError("admin.default_use_map_failed", error);
  }
}
