import type { Metadata } from "next";

import { ActivityScreen } from "@/features/activity/activity-screen";
import { requireCompanyAdmin } from "@/features/company/guard";
import { getActivitySummary } from "@/lib/db/activity-summary";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity · Company" };

export default async function CompanyActivityPage() {
  const { membership } = await requireCompanyAdmin("/company/activity");
  // The admin's own client: activity_summary('company') returns their own company's members only.
  const rows = await getActivitySummary(await createServerSupabase(), "company");
  return <ActivityScreen scope="company" companyName={membership.companyName} rows={rows} />;
}
