import type { Metadata } from "next";

import { ActivityScreen } from "@/features/activity/activity-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { getActivitySummary, parseActivityView } from "@/lib/db/activity-summary";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity · Admin" };

export default async function AdminActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  await requirePlatformAdmin("/admin/activity");
  // The admin's own client: activity_summary() checks the caller and returns counts only.
  const rows = await getActivitySummary(await createServerSupabase(), "platform");
  return <ActivityScreen scope="platform" view={parseActivityView((await searchParams).view)} basePath="/admin/activity" rows={rows} />;
}
