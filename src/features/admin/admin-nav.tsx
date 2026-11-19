"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin/users", label: "Accounts" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/rules", label: "Rule figures" },
  { href: "/admin/audit", label: "Audit log" },
];

export const COMPANY_NAV: readonly NavItem[] = [
  { href: "/company/members", label: "Members" },
  { href: "/company/activity", label: "Activity" },
  { href: "/company/4541", label: "4541 settings" },
];

/** The sections of the admin or company area; the current one is marked for sight and for screen readers. */
export function AreaNav({ label, items }: { label: string; items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex items-center gap-1">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className="rounded border border-transparent px-3 py-1.5 text-ad-sm font-medium text-text focus-ring hover:bg-surface-3 aria-[current=page]:border-border aria-[current=page]:bg-surface-2"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminNav() {
  return <AreaNav label="Admin" items={ADMIN_NAV} />;
}

export function CompanyNav() {
  return <AreaNav label="Company" items={COMPANY_NAV} />;
}
