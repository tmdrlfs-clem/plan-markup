import type { Metadata } from "next";

import { resolveUseMap } from "@/core/sprinkler/use-map";
import { requireCompanyAdmin } from "@/features/company/guard";
import { UseMapScreen } from "@/features/company/use-map-screen";
import { readUseHazardRows } from "@/lib/db/rules";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "4541 settings · Company" };

export default async function Company4541Page() {
  const { membership } = await requireCompanyAdmin("/company/4541");
  // The admin's own client: RLS returns the platform rows and their own company's.
  const rows = await readUseHazardRows(await createServerSupabase());
  return <UseMapScreen companyName={membership.companyName} resolved={resolveUseMap(rows, membership.companyId)} />;
}
