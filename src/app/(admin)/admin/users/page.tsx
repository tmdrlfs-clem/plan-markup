import type { Metadata } from "next";

import { UsersScreen } from "@/features/admin/users-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { listAdminUsers, parseAdminUserQuery } from "@/lib/db/admin-users";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Accounts · Admin" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requirePlatformAdmin("/admin/users");
  const query = parseAdminUserQuery(await searchParams);
  // The admin's own client: RLS (profiles_select_platform_admin) lets them read every profile.
  const list = await listAdminUsers(await createServerSupabase(), query);
  return <UsersScreen adminId={admin.id} query={query} list={list} />;
}
