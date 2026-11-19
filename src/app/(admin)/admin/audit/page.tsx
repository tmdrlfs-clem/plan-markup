import type { Metadata } from "next";

import { AuditScreen } from "@/features/admin/audit-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import { listAuditLog, parseAuditQuery } from "@/lib/db/audit-log";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log · Admin" };

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requirePlatformAdmin("/admin/audit");
  const query = parseAuditQuery(await searchParams);
  // The admin's own client: RLS (audit_log_select_platform_admin) lets them read the log.
  const list = await listAuditLog(await createServerSupabase(), query);
  return <AuditScreen query={query} list={list} />;
}
