import type { Metadata } from "next";

import { ActivityScreen } from "@/features/activity/activity-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { getActivitySummary } from "@/lib/db/activity-summary";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity · Admin" };

export default async function AdminActivityPage() {
  await requirePlatformAdmin("/admin/activity");
  // The admin's own client: activity_summary() checks the caller and returns counts only.
  const rows = await getActivitySummary(await createServerSupabase(), "platform");
  return <ActivityScreen scope="platform" rows={rows} />;
}
