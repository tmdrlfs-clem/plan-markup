"use server";

import { resolveUseMap, type ResolvedUseMap } from "@/core/sprinkler/use-map";
import { getAuthUser } from "@/lib/auth";
import { readUseHazardRows } from "@/lib/db/rules";
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
