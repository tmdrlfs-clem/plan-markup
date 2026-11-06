"use server";

import {
  createToolSetSchema,
  deleteToolSetSchema,
  moveToolSetSchema,
  renameToolSetSchema,
  MAX_TOOL_SETS,
  type ToolSet,
} from "@/core/tools/tool-set";
import { getAuthUser } from "@/lib/auth";
import * as db from "@/lib/db/tool-sets";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 7.1 (FR39): the signed-in user's tool sets. The user comes from the
// session; every read and write goes through RLS with the user's own client.

/** The user's tool sets in their order. */
export async function listToolSets(): Promise<Result<ToolSet[]>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    return { ok: true, data: await db.listToolSets(await createServerSupabase()) };
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
    const set = await db.createToolSet(await createServerSupabase(), parsed.data.name);
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
    return (await db.moveToolSet(await createServerSupabase(), parsed.data.id, parsed.data.direction)) ? { ok: true, data: null } : fail("NOT_FOUND");
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
    return (await db.deleteToolSet(await createServerSupabase(), parsed.data.id)) ? { ok: true, data: null } : fail("NOT_FOUND");
  } catch (error) {
    return internalError("tool_sets.delete_failed", error);
  }
}
