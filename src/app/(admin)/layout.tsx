import Link from "next/link";

import { Toaster } from "@/components/ui/toast";
import { AdminNav } from "@/features/admin/admin-nav";
import { AdminTheme } from "@/features/admin/admin-theme";
import { requirePlatformAdmin } from "@/lib/auth";

// Story 10.4: the platform admin area (Daylight theme). Defence in depth only:
// layouts do not re-run on client navigation, so every admin page and action
// checks the platform-admin flag itself.
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const admin = await requirePlatformAdmin();
  return (
    <div data-theme="daylight" className="flex flex-1 flex-col bg-surface-0 text-text">
      <AdminTheme />
      <header className="border-b border-border bg-surface-1">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <p className="text-ad-md font-semibold">
            Plan Markup <span className="font-normal text-muted">Admin</span>
          </p>
          <AdminNav />
          <div className="ml-auto flex min-w-0 items-center gap-4">
            <span className="min-w-0 truncate text-ad-sm text-muted">{admin.email}</span>
            <Link href="/workspace" className="shrink-0 rounded text-ad-sm font-medium text-text underline underline-offset-2 focus-ring">
              Back to workspace
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-6 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
