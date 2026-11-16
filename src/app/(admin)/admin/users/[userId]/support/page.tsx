import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SupportScreen } from "@/features/admin/support-screen";
import { requirePlatformAdmin } from "@/lib/auth";
import type { ProfileStatus } from "@/lib/db/profiles";
import { isAccountId, lookupMarkupSets } from "@/lib/db/support-lookup";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Support lookup · Admin" };

// Story 10.10: every load of this page is one lookup and writes one audit row,
// so nothing links here with prefetching (the accounts list uses a plain link).
export default async function SupportLookupPage({ params }: PageProps<"/admin/users/[userId]/support">) {
  const admin = await requirePlatformAdmin("/admin/users");
  const { userId } = await params;
  if (!isAccountId(userId)) notFound();

  // Who it is: read through RLS with the admin's own client (profiles_select_platform_admin).
  const supabase = await createServerSupabase();
  const { data: profile, error } = await supabase.from("profiles").select("name, email, status").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not read the account: ${error.code ?? "unknown"}`);
  if (!profile) notFound();

  const lookup = await lookupMarkupSets(admin.id, userId);
  if (lookup.kind !== "ok") notFound();
  return (
    <SupportScreen
      account={{ name: profile.name, email: profile.email, status: profile.status as ProfileStatus }}
      sets={lookup.sets}
    />
  );
}
