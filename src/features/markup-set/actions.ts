"use server";

import { z } from "zod";

import { applyMarkupOpsSchema, type ApplyMarkupOpsInput, type MarkupOpResult } from "@/core/markup-set/markup-ops";
import { ensureMarkupSetSchema, saveCalibrationsSchema, type MarkupSetIds } from "@/core/markup-set/markup-set";
import { getAuthUser } from "@/lib/auth";
import { ensureDrawingFile, saveCalibrations } from "@/lib/db/drawings";
import { applyMarkupOps as applyOps, hasOtherVersion, listMarkupSets, loadMarkupSet as loadSet, MarkupOpsError, type LoadedMarkupSet, type MarkupSetSummary } from "@/lib/db/markups";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 6.1 (A1, AR5): the signed-in user's markup set of a file, made on the
// first edit. The user comes from the session; every write goes through RLS
// with the user's own client. Inputs carry a hash, a filename and page
// geometry, never PDF bytes (NFR26).

/** The user's markup set for `{ sha256, filename, pages }`, made when the hash is new to them. */
export async function ensureMarkupSet(input: unknown): Promise<Result<MarkupSetIds>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = ensureMarkupSetSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    return { ok: true, data: await ensureDrawingFile(await createServerSupabase(), parsed.data) };
  } catch (error) {
    return internalError("markup_set.ensure_failed", error);
  }
}

/** Saves `[{ pageId, calibration | null }]` to the user's own pages. */
export async function saveSetCalibrations(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = saveCalibrationsSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    await saveCalibrations(await createServerSupabase(), parsed.data);
    return { ok: true, data: null };
  } catch (error) {
    return internalError("markup_set.calibrations_failed", error);
  }
}

/**
 * Story 6.2 (AR10, NFR24): applies markup ops `{ drawingId, ops }` to the
 * user's markup set, validated with the shared schemas first. The RPC re-checks
 * access, rate-limits and applies field-level last-write-wins.
 */
export async function applyMarkupOps(input: unknown): Promise<Result<MarkupOpResult[]>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = applyMarkupOpsSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    return { ok: true, data: await applyOps(await createServerSupabase(), parsed.data as ApplyMarkupOpsInput) };
  } catch (error) {
    if (error instanceof MarkupOpsError && error.code !== "INTERNAL") return fail(error.code);
    return internalError("markup_set.ops_failed", error);
  }
}

/** Story 6.4 (FR50): the user's markup set of the file with this SHA-256 (null: none yet). */
export async function loadMarkupSet(sha256: unknown): Promise<Result<LoadedMarkupSet | null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return fail("INVALID_INPUT");
  try {
    return { ok: true, data: await loadSet(await createServerSupabase(), sha256) };
  } catch (error) {
    return internalError("markup_set.load_failed", error);
  }
}

const otherVersionSchema = z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), filename: z.string().trim().min(1).max(255) });

/** Story 6.5 (FR81): whether the user has markups on another version (same filename, other bytes) of this file. */
export async function hasMarkupsOnOtherVersion(input: unknown): Promise<Result<boolean>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = otherVersionSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    return { ok: true, data: await hasOtherVersion(await createServerSupabase(), parsed.data.sha256, parsed.data.filename) };
  } catch (error) {
    return internalError("markup_set.other_version_failed", error);
  }
}

/** Story 6.6 (FR51): the user's markup sets, newest change first. */
export async function listMyMarkupSets(): Promise<Result<MarkupSetSummary[]>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    return { ok: true, data: await listMarkupSets(await createServerSupabase()) };
  } catch (error) {
    return internalError("markup_set.list_failed", error);
  }
}
