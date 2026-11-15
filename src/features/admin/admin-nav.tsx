"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/users", label: "Accounts" },
  { href: "/admin/companies", label: "Companies" },
] as const;

/** The admin area's sections; the current one is marked for sight and for screen readers. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex items-center gap-1">
      {ITEMS.map((item) => {
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
