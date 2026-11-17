import type { SupabaseClient } from "@supabase/supabase-js";

import type { UseHazardRow } from "@/core/sprinkler/use-map";

import type { Database } from "./types.gen";

// Story 9.3 (FR72): the use -> hazard rows the caller may read. RLS (Story
// 10.12): the platform's rows and the rows of the caller's own company; the
// resolver picks.

/** At most this many rows are read (a company map is far smaller). */
export const MAX_USE_ROWS = 1000;

export async function readUseHazardRows(client: SupabaseClient<Database>): Promise<UseHazardRow[]> {
  const { data, error } = await client
    .from("use_hazard_map")
    .select("company_id, map_version, use, hazard, is_default, verified")
    .order("use")
    .limit(MAX_USE_ROWS);
  if (error) throw new Error(`use_hazard_map read failed: ${error.code ?? "unknown"}`);
  return data ?? [];
}
