import { redirect } from "next/navigation";

import { requirePlatformAdmin } from "@/lib/auth";

export default async function AdminHomePage() {
  await requirePlatformAdmin("/admin/users");
  redirect("/admin/users");
}
