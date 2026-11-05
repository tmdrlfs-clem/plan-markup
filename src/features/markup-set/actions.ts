"use server";

import { ensureMarkupSetSchema, saveCalibrationsSchema, type MarkupSetIds } from "@/core/markup-set/markup-set";
import { getAuthUser } from "@/lib/auth";
import { ensureDrawingFile, saveCalibrations } from "@/lib/db/drawings";
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
