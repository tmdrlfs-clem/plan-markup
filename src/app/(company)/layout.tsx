import Link from "next/link";

import { Toaster } from "@/components/ui/toast";
import { AdminTheme } from "@/features/admin/admin-theme";
import { requireCompanyAdmin } from "@/features/company/guard";

// Story 10.6: the Company area, for a company's admins (Daylight, like the
// platform admin area). Defence in depth only: layouts do not re-run on client
// navigation, so every company page and action checks the role itself.
export default async function CompanyLayout({ children }: LayoutProps<"/">) {
  const { user, membership } = await requireCompanyAdmin();
  return (
    <div data-theme="daylight" className="flex flex-1 flex-col bg-surface-0 text-text">
      <AdminTheme />
      <header className="border-b border-border bg-surface-1">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <p className="min-w-0 truncate text-ad-md font-semibold">
            {membership.companyName} <span className="font-normal text-muted">Company</span>
          </p>
          <nav aria-label="Company" className="flex items-center gap-1">
            <Link
              href="/company/members"
              aria-current="page"
              className="rounded border border-border bg-surface-2 px-3 py-1.5 text-ad-sm font-medium text-text focus-ring hover:bg-surface-3"
            >
              Members
            </Link>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-4">
            <span className="min-w-0 truncate text-ad-sm text-muted">{user.email}</span>
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
