import type { Metadata } from "next";

import { resolveUseMap } from "@/core/sprinkler/use-map";
import { RulesScreen } from "@/features/admin/rules-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { readRuleFigureRows, readUseHazardRows } from "@/lib/db/rules";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rule figures · Admin" };

export default async function AdminRulesPage() {
  await requirePlatformAdmin("/admin/rules");
  // The admin's own client: every version of the figures, and the platform's mapping rows (the admin is in no company).
  const client = await createServerSupabase();
  const [figures, uses] = await Promise.all([readRuleFigureRows(client), readUseHazardRows(client)]);
  return <RulesScreen figures={figures} mapping={resolveUseMap(uses, null)} />;
}
