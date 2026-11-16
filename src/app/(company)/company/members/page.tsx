import type { Metadata } from "next";

import { requireCompanyAdmin } from "@/features/company/guard";
import { MembersScreen } from "@/features/company/members-screen";
import { listCompanyMembers, listOpenInvitations } from "@/lib/db/companies";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members · Company" };

export default async function CompanyMembersPage() {
  const { user, membership } = await requireCompanyAdmin("/company/members");
  // The admin's own client: list_company_members() and RLS limit both lists to their company.
  const supabase = await createServerSupabase();
  const [members, invitations] = await Promise.all([listCompanyMembers(supabase), listOpenInvitations(supabase, membership.companyId)]);
  return <MembersScreen companyName={membership.companyName} currentUserId={user.id} members={members} invitations={invitations} />;
}
