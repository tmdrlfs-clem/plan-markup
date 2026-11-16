import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRole } from "./admin-companies";
import type { Database } from "./types.gen";

// Story 10.6: a user's own company, its members and its invitations, read
// with the user's own client. RLS and list_company_members() decide who sees what.

export type { CompanyRole };

export const COMPANY_ROLES: readonly CompanyRole[] = ["admin", "member", "viewer"];

export const ROLE_LABELS: Record<CompanyRole, string> = { admin: "Admin", member: "Member", viewer: "Viewer" };

function asRole(value: string): CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(value) ? (value as CompanyRole) : "viewer";
}

export type Membership = { companyId: string; companyName: string; role: CompanyRole };

/** The signed-in user's company and role, or null when they are in none. Throws on a query error. */
export async function getOwnMembership(client: SupabaseClient<Database>, userId: string): Promise<Membership | null> {
  const { data, error } = await client
    .from("company_members")
    .select("role, company:companies!fk_company_members_company(id, name)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the membership: ${error.code ?? "unknown"}`);
  if (!data || !data.company) return null;
  return { companyId: data.company.id, companyName: data.company.name, role: asRole(data.role) };
}

export type CompanyMember = { userId: string; name: string; email: string; role: CompanyRole; joinedAt: string };

/** The members of the caller's company. Empty unless the caller is its active admin. */
export async function listCompanyMembers(client: SupabaseClient<Database>): Promise<CompanyMember[]> {
  const { data, error } = await client.rpc("list_company_members");
  if (error) throw new Error(`Could not list the members: ${error.code ?? "unknown"}`);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: asRole(row.role),
    joinedAt: row.joined_at,
  }));
}

export type CompanyInvitation = {
  id: string;
  email: string;
  role: CompanyRole;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

/** Invitations of this company that are neither accepted nor revoked, newest first. */
export async function listOpenInvitations(
  client: SupabaseClient<Database>,
  companyId: string,
  now: Date = new Date(),
): Promise<CompanyInvitation[]> {
  const { data, error } = await client
    .from("company_invitations")
    // Named columns: token_hash is not readable, so "*" would be refused.
    .select("id, email, role, created_at, expires_at")
    .eq("company_id", companyId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not list the invitations: ${error.code ?? "unknown"}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: asRole(row.role),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= now.getTime(),
  }));
}
