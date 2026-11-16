"use server";

import { uuidv7 } from "@/core/ids/uuid";
import { addToolSchema } from "@/core/tools/tool";
import {
  createToolSetSchema,
  deleteToolSetSchema,
  moveToolSetSchema,
  publishToolSetSchema,
  renameToolSetSchema,
  MAX_TOOL_SETS,
  type ToolSet,
} from "@/core/tools/tool-set";
import { getCompanyAdmin } from "@/features/company/guard";
import { getAuthUser } from "@/lib/auth";
import * as db from "@/lib/db/tool-sets";
import { fail, internalError, type Result } from "@/lib/result";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 7.1 (FR39): the signed-in user's tool sets. The user comes from the
// session; every read and write goes through RLS with the user's own client.
// Story 10.11 (FR44): a company admin publishes one of their sets to their
// company; that one write is a database function that checks the actor again
// and writes audit_log.

/** The sets others published to the user's company, then the user's own in their order. */
export async function listToolSets(): Promise<Result<ToolSet[]>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    return { ok: true, data: await db.listToolSets(await createServerSupabase(), user.id) };
  } catch (error) {
    return internalError("tool_sets.list_failed", error);
  }
}

/** Creates `{ name }` after the user's last set. */
export async function createToolSet(input: unknown): Promise<Result<ToolSet>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = createToolSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  try {
    const set = await db.createToolSet(await createServerSupabase(), user.id, parsed.data.name);
    return set ? { ok: true, data: set } : fail("INVALID_INPUT", `At most ${MAX_TOOL_SETS} tool sets.`);
  } catch (error) {
    return internalError("tool_sets.create_failed", error);
  }
}

/** Renames `{ id, name }`. */
export async function renameToolSet(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = renameToolSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  try {
    return (await db.renameToolSet(await createServerSupabase(), parsed.data.id, parsed.data.name)) ? { ok: true, data: null } : fail("NOT_FOUND");
  } catch (error) {
    return internalError("tool_sets.rename_failed", error);
  }
}

/** Moves `{ id, direction }` one place up (-1) or down (1). */
export async function moveToolSet(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = moveToolSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    return (await db.moveToolSet(await createServerSupabase(), user.id, parsed.data.id, parsed.data.direction)) ? { ok: true, data: null } : fail("NOT_FOUND");
  } catch (error) {
    return internalError("tool_sets.move_failed", error);
  }
}

/** Deletes `{ id }` and its tools. */
export async function deleteToolSet(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = deleteToolSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    return (await db.deleteToolSet(await createServerSupabase(), user.id, parsed.data.id)) ? { ok: true, data: null } : fail("NOT_FOUND");
  } catch (error) {
    return internalError("tool_sets.delete_failed", error);
  }
}

/**
 * Story 7.2 (FR40): adds a tool `{ set, name, content, device, image }` to one
 * of the user's sets (or a new set by name); its image goes to the private
 * tool-assets bucket first.
 */
export async function addTool(input: unknown): Promise<Result<db.AddedTool>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = addToolSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  try {
    const added = await db.addTool(await createServerSupabase(), user.id, parsed.data, uuidv7);
    if (added === "full") return fail("INVALID_INPUT", "That tool set is full.");
    return added ? { ok: true, data: added } : fail("NOT_FOUND");
  } catch (error) {
    return internalError("tools.add_failed", error);
  }
}

/**
 * Story 10.11 (FR44): publishes `{ id, published: true }` to the admin's
 * company, or withdraws it (`published: false`). Answers with the company's name.
 */
export async function publishToolSet(input: unknown): Promise<Result<{ published: boolean; companyName: string }>> {
  const admin = await getCompanyAdmin();
  if (!admin) return fail("FORBIDDEN");
  const parsed = publishToolSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { id, published } = parsed.data;
  try {
    const { data, error } = await createAdminSupabase().rpc("set_tool_set_published", {
      p_actor_id: admin.user.id,
      p_tool_set_id: id,
      p_published: published,
    });
    if (error) {
      if (error.code === "PT403") return fail("FORBIDDEN");
      if (error.code === "PT404") return fail("NOT_FOUND");
      if (error.code === "PT409") {
        return fail("CONFLICT", `Your company already has ${db.MAX_COMPANY_TOOL_SETS} published tool sets. Withdraw one first.`);
      }
      return internalError("tool_sets.publish_failed", new Error(`set_tool_set_published failed: ${error.code ?? "unknown"}`));
    }
    const row = data?.[0];
    if (!row) return internalError("tool_sets.publish_failed", new Error("set_tool_set_published returned no row"));
    return { ok: true, data: { published, companyName: row.company_name } };
  } catch (error) {
    return internalError("tool_sets.publish_failed", error);
  }
}
