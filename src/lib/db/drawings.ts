import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalibrationEntry, EnsureMarkupSetInput, MarkupSetIds } from "@/core/markup-set/markup-set";
import type { Database, Json } from "./types.gen";

// Story 6.1: the markup set tables (snake_case) to the app's camelCase (AR7).
// Every call runs as the caller (RLS); errors throw with the code only.

/** The caller's markup set for the file, made by `ensure_drawing_file` on the first call. */
export async function ensureDrawingFile(client: SupabaseClient<Database>, input: EnsureMarkupSetInput): Promise<MarkupSetIds> {
  const { data, error } = await client.rpc("ensure_drawing_file", {
    p_sha256: input.sha256,
    p_filename: input.filename,
    p_pages: input.pages as unknown as Json,
  });
  if (error) throw new Error(`ensure_drawing_file failed: ${error.code ?? "unknown"}`);
  const row = data?.[0];
  if (!row || row.page_ids.length !== input.pages.length) throw new Error("ensure_drawing_file returned no set");
  return { drawingId: row.drawing_id, fileId: row.file_id, pageIds: row.page_ids };
}

/** Saves calibrations by page id (upserted; null deletes). Pages the caller does not own fail by RLS. */
export async function saveCalibrations(client: SupabaseClient<Database>, entries: readonly CalibrationEntry[]): Promise<void> {
  const now = new Date().toISOString();
  const upserts = entries.filter((e) => e.calibration).map((e) => ({ page_id: e.pageId, calibration: e.calibration as unknown as NonNullable<Json>, updated_at: now }));
  const deletes = entries.filter((e) => !e.calibration).map((e) => e.pageId);
  if (upserts.length) {
    const { error } = await client.from("calibrations").upsert(upserts);
    if (error) throw new Error(`calibrations upsert failed: ${error.code ?? "unknown"}`);
  }
  if (deletes.length) {
    const { error } = await client.from("calibrations").delete().in("page_id", deletes);
    if (error) throw new Error(`calibrations delete failed: ${error.code ?? "unknown"}`);
  }
}
