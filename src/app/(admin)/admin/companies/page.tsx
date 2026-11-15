import type { Metadata } from "next";

import { CompaniesScreen } from "@/features/admin/companies-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { listAdminCompanies } from "@/lib/db/admin-companies";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Companies · Admin" };

export default async function AdminCompaniesPage() {
  await requirePlatformAdmin("/admin/companies");
  // The admin's own client: RLS lets the platform admin read every company and member.
  const companies = await listAdminCompanies(await createServerSupabase());
  return <CompaniesScreen companies={companies} />;
}
