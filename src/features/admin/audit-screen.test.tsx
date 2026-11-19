// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AuditEntry, AuditList } from "@/lib/db/audit-log";
import { AuditScreen, auditHref } from "./audit-screen";

const A = "00000000-0000-4000-8000-00000000000a";
const U = "00000000-0000-4000-8000-00000000000b";

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: "e1",
    occurredAt: "2026-11-19T01:05:00Z",
    action: "user.activated",
    actor: { id: A, label: "Ada Admin", email: "ada@x.test", known: true },
    targetType: "user",
    target: { id: U, label: "Pat", email: "pat@x.test", known: true },
    detail: { from: "pending", to: "active" },
    people: {},
    ...over,
  };
}

const list = (entries: AuditEntry[], total = entries.length): AuditList => ({ entries, total, searchTruncated: false });

describe("auditHref", () => {
  it("leaves the defaults out", () => {
    expect(auditHref({ area: "all", search: "", page: 1 })).toBe("/admin/audit");
    expect(auditHref({ area: "rules", search: "a&b", page: 2 })).toBe("/admin/audit?area=rules&q=a%26b&page=2");
  });
});

describe("AuditScreen", () => {
  it("shows who did what to whom, in NZ time", () => {
    render(<AuditScreen query={{ area: "all", search: "", page: 1 }} list={list([entry({})])} />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Ada Admin")).toBeTruthy();
    expect(within(row).getByText("Activated the account (was waiting)")).toBeTruthy();
    expect(within(row).getByText("Pat")).toBeTruthy();
    expect(within(row).getByText("pat@x.test")).toBeTruthy();
    expect(row.querySelector("time")?.textContent).toBe("19 Nov 2026, 2:05 pm");
    expect(screen.getByRole("status").textContent).toBe("1–1 of 1 entry");
  });

  it("names people inside the detail, and marks removed accounts", () => {
    render(
      <AuditScreen
        query={{ area: "company", search: "", page: 1 }}
        list={list([
          entry({
            action: "company.member_role_changed",
            targetType: "company",
            target: { id: "c", label: "Acme Fire", email: null, known: true },
            detail: { user_id: U, from: "member", to: "admin" },
            people: { [U]: { id: U, label: "Removed account", email: null, known: false } },
          }),
        ])}
      />,
    );
    expect(screen.getByText(/Changed the role of/).textContent).toBe("Changed the role of Removed account: member → admin");
    expect(screen.getByRole("link", { name: "Companies" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders detail as text, never as markup, and shows unknown actions by code", () => {
    const { container } = render(
      <AuditScreen query={{ area: "all", search: "", page: 1 }} list={list([entry({ action: "company.something_new", detail: { name: "<img src=x onerror=alert(1)>" } })])} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("company.something_new")).toBeTruthy();
    expect(container.querySelector("pre")?.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("pages through the log and says when a search finds nothing", () => {
    const { rerender } = render(<AuditScreen query={{ area: "all", search: "", page: 2 }} list={list([entry({})], 120)} />);
    expect(screen.getByRole("status").textContent).toBe("51–100 of 120 entries");
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/admin/audit");
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/admin/audit?page=3");

    rerender(<AuditScreen query={{ area: "all", search: "zed", page: 1 }} list={list([])} />);
    expect(screen.getByText('Nothing here involves "zed".')).toBeTruthy();
  });
});
