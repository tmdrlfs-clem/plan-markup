import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Story 10.10 (FR15): the platform admin's support lookup. One call to
// public.admin_lookup_markup_sets, which checks the actor, records the lookup
// in audit_log and returns names and counts only: no drawing content.

export type SupportSet = {
  id: string;
  filename: string;
  /** Pages of the newest file; null when the set has no file yet. */
  pageCount: number | null;
  /** File versions kept in the set. */
  fileCount: number;
  markupCount: number;
  createdAt: string;
  lastSavedAt: string | null;
};

export type SupportLookup = { kind: "ok"; sets: SupportSet[] } | { kind: "forbidden" } | { kind: "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether a route parameter can be an account id at all. */
export function isAccountId(value: string): boolean {
  return UUID.test(value);
}

/**
 * Looks up `userId`'s markup sets as `actorId`. The lookup is recorded even
 * when it finds nothing. Throws on an unexpected error.
 */
export async function lookupMarkupSets(actorId: string, userId: string): Promise<SupportLookup> {
  const { data, error } = await createAdminSupabase().rpc("admin_lookup_markup_sets", { p_actor_id: actorId, p_user_id: userId });
  if (error) {
    if (error.code === "PT403") return { kind: "forbidden" };
    if (error.code === "PT404") return { kind: "not_found" };
    throw new Error(`Could not look up the markup sets: ${error.code ?? "unknown"}`);
  }
  return {
    kind: "ok",
    sets: (data ?? []).map((row) => ({
      id: row.drawing_id,
      filename: row.filename,
      pageCount: row.page_count,
      fileCount: row.file_count,
      markupCount: row.markup_count,
      createdAt: row.created_at,
      lastSavedAt: row.last_saved_at,
    })),
  };
}
