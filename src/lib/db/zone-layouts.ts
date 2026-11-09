import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaveZoneLayouts } from "@/core/sprinkler/zone-layout";

import type { Database, Json } from "./types.gen";

// Story 9.8 (A7): saves a Place heads run, one row per zone, as the caller
// through RLS (access to the markup set; the author and time are the
// server's). Errors carry the SQLSTATE only.

export class ZoneLayoutError extends Error {
  constructor(readonly code: "RATE_LIMITED" | "FORBIDDEN" | "INTERNAL", sqlState: string) {
    super(`zone layout save failed: ${sqlState}`);
  }
}

export async function insertZoneLayouts(client: SupabaseClient<Database>, input: SaveZoneLayouts): Promise<void> {
  const { error } = await client.from("zone_layouts").insert(
    input.layouts.map((l) => ({
      drawing_id: input.drawingId,
      zone_id: l.zoneId,
      ruleset_id: l.rulesetId,
      rule_figure_version: l.ruleVersion,
      status: l.status,
      head_count: l.headCount,
      inputs: l.inputs as NonNullable<Json>,
      result: l.result as NonNullable<Json>,
      report: l.report as Json | null,
    })),
  );
  if (!error) return;
  const state = error.code ?? "unknown";
  throw new ZoneLayoutError(state === "PT429" ? "RATE_LIMITED" : state === "42501" ? "FORBIDDEN" : "INTERNAL", state);
}
