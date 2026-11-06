import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { markupOpResultSchema, type ApplyMarkupOpsInput, type MarkupOpResult } from "@/core/markup-set/markup-ops";
import type { Database, Json } from "./types.gen";

// Story 6.2 (AR7): markup ops to `apply_markup_ops` and its results back. The
// ops already use the RPC's JSON names (camelCase inside jsonb); the only
// snake_case here is the RPC's own arguments. Runs as the caller (the RPC
// re-checks access); errors carry the SQLSTATE only.

/** A refused call: SQLSTATE `42501` → forbidden, `22023` → invalid, `PT429` → rate limited. */
export class MarkupOpsError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "RATE_LIMITED" | "INTERNAL", sqlState: string) {
    super(`apply_markup_ops failed: ${sqlState}`);
    this.name = "MarkupOpsError";
  }
}

function codeOf(sqlState: string | undefined): MarkupOpsError["code"] {
  if (sqlState === "42501") return "FORBIDDEN";
  if (sqlState === "22023") return "INVALID_INPUT";
  if (sqlState === "PT429") return "RATE_LIMITED";
  return "INTERNAL";
}

/** Applies `ops` to the drawing's markups, in order; one result per op. */
export async function applyMarkupOps(client: SupabaseClient<Database>, input: ApplyMarkupOpsInput): Promise<MarkupOpResult[]> {
  const { data, error } = await client.rpc("apply_markup_ops", { p_drawing_id: input.drawingId, p_ops: input.ops as unknown as Json });
  if (error) throw new MarkupOpsError(codeOf(error.code), error.code ?? "unknown");
  const parsed = z.array(markupOpResultSchema).length(input.ops.length).safeParse(data);
  if (!parsed.success) throw new MarkupOpsError("INTERNAL", "bad_result");
  return parsed.data;
}
