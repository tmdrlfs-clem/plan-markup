// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getActivitySummary, groupByCompany, type ActivityRow } from "@/lib/db/activity-summary";
import { ActivityScreen, lastActive } from "./activity-screen";

function row(over: Partial<ActivityRow>): ActivityRow {
  return {
    userId: "u1",
    name: "Pat Designer",
    email: "pat@acme.test",
    status: "active",
    companyId: "c1",
    companyName: "Acme Fire",
    lastActiveAt: "2026-11-15T22:00:00Z",
    markupsTotal: 40,
    markupsByWeek: [5, 3, 0, 1],
    exportsTotal: 6,
    exportsByWeek: [2, 0, 1, 0],
    ...over,
  };
}

const ROWS: ActivityRow[] = [
  row({}),
  row({ userId: "u2", name: "", email: "vee@acme.test", status: "deactivated", lastActiveAt: "2026-11-01T00:00:00Z", markupsTotal: 2, markupsByWeek: [0, 0, 0, 0], exportsTotal: 0, exportsByWeek: [0, 0, 0, 0] }),
  row({ userId: "u3", name: "Sol Solo", email: "sol@solo.test", companyId: null, companyName: null, lastActiveAt: null, markupsTotal: 0, markupsByWeek: [0, 0, 0, 0], exportsTotal: 0, exportsByWeek: [0, 0, 0, 0] }),
  row({ userId: "u4", name: "Bea Beta", email: "bea@beta.test", companyId: "c0", companyName: "Beta Sprinklers", markupsTotal: 7, markupsByWeek: [7, 0, 0, 0], exportsTotal: 1, exportsByWeek: [0, 1, 0, 0] }),
];

/** The table row that holds this text. */
function rowOf(table: HTMLElement, text: string): HTMLElement {
  const tr = within(table).getByText(text).closest("tr");
  if (!tr) throw new Error(`no row for ${text}`);
  return tr;
}

/** The numbers of a table row, in column order (after name and last active). */
function counts(el: HTMLElement): string[] {
  return within(el)
    .getAllByRole("cell")
    .slice(1)
    .map((cell) => cell.textContent ?? "");
}

describe("getActivitySummary", () => {
  it("asks for the scope and maps the rows, padding the weeks", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "u1",
          name: "Pat",
          email: "pat@acme.test",
          status: "active",
          company_id: "c1",
          company_name: "Acme Fire",
          last_active_at: "2026-11-15T22:00:00Z",
          markups_total: 5,
          markups_by_week: [2, 1],
          exports_total: 3,
          exports_by_week: null,
        },
      ],
      error: null,
    });
    const rows = await getActivitySummary({ rpc } as never, "company");
    expect(rpc).toHaveBeenCalledWith("activity_summary", { p_scope: "company" });
    expect(rows).toEqual([
      expect.objectContaining({ userId: "u1", companyName: "Acme Fire", markupsTotal: 5, markupsByWeek: [2, 1, 0, 0], exportsByWeek: [0, 0, 0, 0] }),
    ]);
  });

  it("throws on a query error (the page shows the error screen)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(getActivitySummary({ rpc } as never, "platform")).rejects.toThrow("Could not read the activity: 42501");
  });
});

describe("groupByCompany", () => {
  it("groups by company in name order with totals, and puts accounts in no company last", () => {
    const groups = groupByCompany(ROWS);
    expect(groups.map((g) => g.companyName)).toEqual(["Acme Fire", "Beta Sprinklers", null]);
    expect(groups[0]).toMatchObject({
      markupsTotal: 42,
      markupsByWeek: [5, 3, 0, 1],
      exportsTotal: 6,
      exportsByWeek: [2, 0, 1, 0],
      lastActiveAt: "2026-11-15T22:00:00Z",
    });
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[2]).toMatchObject({ companyId: null, lastActiveAt: null, markupsTotal: 0 });
    expect(groupByCompany([])).toEqual([]);
  });
});

describe("ActivityScreen", () => {
  it("shows the platform admin every company with its totals and people", () => {
    render(<ActivityScreen scope="platform" rows={ROWS} />);
    const table = screen.getByRole("table", { name: "Activity by company and account" });
    const acme = rowOf(table, "Acme Fire");
    expect(acme).toHaveTextContent("2 people");
    expect(within(acme).getByText("16 Nov 2026")).toBeInTheDocument();
    // Markups this week, all time; PDFs this week, last week, 2 and 3 weeks ago.
    expect(counts(acme)).toEqual(["5", "42", "2", "0", "1", "0"]);
    const pat = within(table).getByRole("row", { name: /Pat Designer/ });
    expect(counts(pat)).toEqual(["5", "40", "2", "0", "1", "0"]);
    expect(within(table).getByRole("row", { name: /vee@acme\.test · deactivated/ })).toHaveTextContent("No name yet");
    const solo = rowOf(table, "Individual accounts");
    expect(solo).toHaveTextContent("1 person");
    expect(within(solo).getByText("Never")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Markups saved" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "3 weeks ago" })).toBeInTheDocument();
  });

  it("shows a company admin their own company under one heading", () => {
    render(<ActivityScreen scope="company" companyName="Acme Fire" rows={ROWS.slice(0, 2)} />);
    const table = screen.getByRole("table", { name: "Activity of Acme Fire" });
    expect(rowOf(table, "Whole company")).toHaveTextContent("2 people");
    expect(within(table).queryByText("Acme Fire")).toBeNull();
    expect(screen.getByText(/When the people of Acme Fire were last active/)).toBeInTheDocument();
  });

  it("says so when there is nothing, and formats a missing or broken time as Never", () => {
    render(<ActivityScreen scope="platform" rows={[]} />);
    expect(screen.getByText("No accounts yet.")).toBeInTheDocument();
    expect(lastActive(null)).toBe("Never");
    expect(lastActive("not a date")).toBe("Never");
    expect(lastActive("2026-11-15T22:00:00Z")).toBe("16 Nov 2026");
  });
});
