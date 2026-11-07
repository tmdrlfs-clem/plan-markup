import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityEvent } from "@/core/activity/activity-event";

import type { Database } from "./types.gen";

// Story 8.4 (FR80): writes one activity event as the caller, through RLS
// (insert own; the time is the server's). Errors carry the SQLSTATE only.

export class ActivityError extends Error {
  constructor(readonly code: "RATE_LIMITED" | "FORBIDDEN" | "INTERNAL", sqlState: string) {
    super(`activity event failed: ${sqlState}`);
  }
}

export async function recordActivityEvent(client: SupabaseClient<Database>, event: ActivityEvent): Promise<void> {
  const { error } = await client.from("activity_events").insert({
    name: event.name,
    drawing_id: event.drawingId,
    page_count: event.pageCount,
    markup_count: event.markupCount,
    kind: event.kind,
  });
  if (!error) return;
  const state = error.code ?? "unknown";
  throw new ActivityError(state === "PT429" ? "RATE_LIMITED" : state === "42501" ? "FORBIDDEN" : "INTERNAL", state);
}
