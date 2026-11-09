"use server";

import { resolveUseMap, type ResolvedUseMap } from "@/core/sprinkler/use-map";
import { saveZoneLayoutsSchema } from "@/core/sprinkler/zone-layout";
import { getAuthUser } from "@/lib/auth";
import { readUseHazardRows } from "@/lib/db/rules";
import { ZoneLayoutError, insertZoneLayouts } from "@/lib/db/zone-layouts";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 9.3 (FR71, FR72): the use -> hazard mapping the user's zones follow.
// Companies arrive in M3 (FR72 admin): until then no user has one, so the
// platform default rows apply (else the built-in JSON).

export async function getUseHazardMap(): Promise<Result<ResolvedUseMap>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    const rows = await readUseHazardRows(await createServerSupabase());
    return { ok: true, data: resolveUseMap(rows, null) };
  } catch (error) {
    return internalError("rules.use_map_failed", error);
  }
}

/**
 * Story 9.8 (A7): saves a Place heads run, one row per zone, with the ruleset version it used.
 * The user comes from the session; the rows go through RLS with the user's own client.
 */
export async function saveZoneLayouts(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = saveZoneLayoutsSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    await insertZoneLayouts(await createServerSupabase(), parsed.data);
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof ZoneLayoutError && error.code !== "INTERNAL") return fail(error.code);
    return internalError("sprinkler.layout_save_failed", error);
  }
}
