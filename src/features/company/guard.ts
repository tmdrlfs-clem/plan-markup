import "server-only";
import { notFound } from "next/navigation";
import { getAuthUser, requireActiveUser, type AuthUser } from "@/lib/auth";
import { getOwnMembership, type Membership } from "@/lib/db/companies";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 10.6: who may open and use the Company area. The role is read from
// company_members on every request, through the user's own client (RLS).

export type CompanyAdmin = { user: AuthUser; membership: Membership };

/**
 * Page guard: the active admin of a company, or a redirect for anonymous and
 * inactive users, or a 404 for everyone else. Every company page calls it itself.
 */
export async function requireCompanyAdmin(nextPath?: string): Promise<CompanyAdmin> {
  const user = await requireActiveUser(nextPath);
  const membership = await getOwnMembership(await createServerSupabase(), user.id);
  if (!membership || membership.role !== "admin") notFound();
  return { user, membership };
}

/** Action guard: the active admin of a company, or null. */
export async function getCompanyAdmin(): Promise<CompanyAdmin | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const membership = await getOwnMembership(await createServerSupabase(), user.id);
  return membership && membership.role === "admin" ? { user, membership } : null;
}
