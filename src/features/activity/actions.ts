"use server";

import { activityEventSchema } from "@/core/activity/activity-event";
import { getAuthUser } from "@/lib/auth";
import { ActivityError, recordActivityEvent } from "@/lib/db/activity";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 8.4 (FR80, AR21): records a completed export or print for pilot
// metrics. The user comes from the session; the row goes through RLS with the
// user's own client. Counts and kinds only, never drawing content.

export async function recordActivity(input: unknown): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = activityEventSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    await recordActivityEvent(await createServerSupabase(), parsed.data);
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof ActivityError && error.code !== "INTERNAL") return fail(error.code);
    return internalError("activity.record_failed", error);
  }
}
