"use server";

import { resolveUseMap, type ResolvedUseMap } from "@/core/sprinkler/use-map";
import { saveZoneLayoutsSchema } from "@/core/sprinkler/zone-layout";
import { getAuthUser } from "@/lib/auth";
import { getOwnMembership } from "@/lib/db/companies";
import { readUseHazardRows } from "@/lib/db/rules";
import { ZoneLayoutError, insertZoneLayouts } from "@/lib/db/zone-layouts";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 9.3 (FR71, FR72): the use -> hazard mapping the user's zones follow.
// Story 10.12: their company's own mapping when it has one (RLS returns the
// platform rows and the rows of the user's company), else the platform
// default rows, else the built-in JSON.

export async function getUseHazardMap(): Promise<Result<ResolvedUseMap>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    const client = await createServerSupabase();
    const [rows, membership] = await Promise.all([readUseHazardRows(client), getOwnMembership(client, user.id)]);
    return { ok: true, data: resolveUseMap(rows, membership?.companyId ?? null) };
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
