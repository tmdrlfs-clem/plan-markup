import type { SupabaseClient } from "@supabase/supabase-js";
import { asPlan, type Plan } from "@/lib/plans";
import type { Database } from "./types.gen";

// Story 10.5: the platform admin's company list. Read with the admin's own
// client: RLS (the *_or_platform_admin policies) decides, not this code.

export type CompanyRole = "admin" | "member" | "viewer";

export type AdminCompanyRow = {
  id: string;
  name: string;
  /** Story 10.8. */
  plan: Plan;
  createdAt: string;
  memberCount: number;
  /** The company's admins, by name (or email when there is no name). */
  admins: { name: string; email: string }[];
};

/** The most companies the list shows; the pilot has a handful. */
export const ADMIN_COMPANIES_LIMIT = 200;

export async function listAdminCompanies(client: SupabaseClient<Database>): Promise<AdminCompanyRow[]> {
  const { data, error } = await client
    .from("companies")
    // The foreign keys are named: PostgREST refuses an embed it finds ambiguous (PGRST201).
    .select(
      "id, name, plan, created_at, members:company_members!fk_company_members_company(role, profile:profiles!fk_company_members_profile(name, email))",
    )
    .order("name", { ascending: true })
    .limit(ADMIN_COMPANIES_LIMIT);
  if (error) throw new Error(`Could not list the companies: ${error.code ?? "unknown"}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    plan: asPlan(row.plan),
    createdAt: row.created_at,
    memberCount: row.members.length,
    admins: row.members
      .filter((m) => m.role === "admin" && m.profile)
      .map((m) => ({ name: m.profile.name, email: m.profile.email }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  }));
}
