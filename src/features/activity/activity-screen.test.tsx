// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getActivitySummary, groupByCompany, parseActivityView, type ActivityRow } from "@/lib/db/activity-summary";
import { ActivityScreen, lastActive } from "./activity-screen";

const ZERO = [0, 0, 0, 0];

function row(over: Partial<ActivityRow>): ActivityRow {
  return {
    userId: "u1",
    name: "Pat Designer",
    email: "pat@acme.test",
    status: "active",
    companyId: "c1",
    companyName: "Acme Fire",
    lastActiveAt: "2026-11-15T22:00:00Z",
    activeDaysByWeek: [3, 5, 0, 1],
    drawingsByWeek: [2, 4, 0, 1],
    markupsTotal: 40,
    markupsByWeek: [5, 3, 0, 1],
    exportsTotal: 6,
    exportsByWeek: [2, 0, 1, 0],
    printsByWeek: [1, 0, 0, 0],
    placementsByWeek: [4, 0, 0, 0],
    ...over,
  };
}

const IDLE = { activeDaysByWeek: ZERO, drawingsByWeek: ZERO, markupsByWeek: ZERO, exportsTotal: 0, exportsByWeek: ZERO, printsByWeek: ZERO, placementsByWeek: ZERO };

const ROWS: ActivityRow[] = [
  row({}),
  row({ ...IDLE, userId: "u2", name: "", email: "vee@acme.test", status: "deactivated", lastActiveAt: "2026-11-01T00:00:00Z", markupsTotal: 2 }),
  row({ ...IDLE, userId: "u3", name: "Sol Solo", email: "sol@solo.test", companyId: null, companyName: null, lastActiveAt: null, markupsTotal: 0 }),
  row({
    ...IDLE,
    userId: "u4",
    name: "Bea Beta",
    email: "bea@beta.test",
    companyId: "c0",
    companyName: "Beta Sprinklers",
    activeDaysByWeek: [1, 0, 0, 0],
    markupsTotal: 7,
    markupsByWeek: [7, 0, 0, 0],
    exportsTotal: 1,
    exportsByWeek: [0, 1, 0, 0],
  }),
];

/** The table row that holds this text. */
function rowOf(table: HTMLElement, text: string): HTMLElement {
  const tr = within(table).getByText(text).closest("tr");
  if (!tr) throw new Error(`no row for ${text}`);
  return tr;
}

/** The cells of a table row after its name. */
function cells(el: HTMLElement): string[] {
  return within(el)
    .getAllByRole("cell")
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
          active_days_by_week: [3],
          drawings_by_week: [2, 1, 0, 0],
          markups_total: 5,
          markups_by_week: [2, 1],
          exports_total: 3,
          exports_by_week: null,
          prints_by_week: [1, 0, 0, 0],
          placements_by_week: undefined,
        },
      ],
      error: null,
    });
    const rows = await getActivitySummary({ rpc } as never, "company");
    expect(rpc).toHaveBeenCalledWith("activity_summary", { p_scope: "company" });
    expect(rows).toEqual([
      expect.objectContaining({
        userId: "u1",
        companyName: "Acme Fire",
        activeDaysByWeek: [3, 0, 0, 0],
        drawingsByWeek: [2, 1, 0, 0],
        markupsTotal: 5,
        markupsByWeek: [2, 1, 0, 0],
        exportsByWeek: ZERO,
        printsByWeek: [1, 0, 0, 0],
        placementsByWeek: ZERO,
      }),
    ]);
  });

  it("throws on a query error (the page shows the error screen)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(getActivitySummary({ rpc } as never, "platform")).rejects.toThrow("Could not read the activity: 42501");
  });
});

describe("parseActivityView", () => {
  it("is the one-week view unless ?view=weeks", () => {
    expect(parseActivityView(undefined)).toBe("week");
    expect(parseActivityView("weeks")).toBe("weeks");
    expect(parseActivityView(["weeks", "x"])).toBe("weeks");
    expect(parseActivityView("year")).toBe("week");
  });
});

describe("groupByCompany", () => {
  it("groups by company in name order with totals, and puts accounts in no company last", () => {
    const groups = groupByCompany(ROWS);
    expect(groups.map((g) => g.companyName)).toEqual(["Acme Fire", "Beta Sprinklers", null]);
    expect(groups[0]).toMatchObject({
      // One of the two people was active this week and last, none two weeks ago.
      activePeopleByWeek: [1, 1, 0, 1],
      drawingsByWeek: [2, 4, 0, 1],
      markupsTotal: 42,
      markupsByWeek: [5, 3, 0, 1],
      exportsTotal: 6,
      exportsByWeek: [2, 0, 1, 0],
      printsByWeek: [1, 0, 0, 0],
      placementsByWeek: [4, 0, 0, 0],
      lastActiveAt: "2026-11-15T22:00:00Z",
    });
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[2]).toMatchObject({ companyId: null, lastActiveAt: null, markupsTotal: 0, activePeopleByWeek: ZERO });
    expect(groupByCompany([])).toEqual([]);
  });
});

describe("ActivityScreen, this week", () => {
  it("shows the platform admin each company and person: days active and each kind of work this week", () => {
    render(<ActivityScreen scope="platform" view="week" basePath="/admin/activity" rows={ROWS} />);
    const table = screen.getByRole("table", { name: "Activity by company and account, this week" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Company and account",
      "Last active",
      "Days active",
      "Drawings",
      "Markups saved",
      "PDFs exported",
      "Prints",
      "Head layouts",
    ]);
    // Last active, days of 7, drawings, markups, PDFs, prints, head layouts.
    expect(cells(rowOf(table, "Pat Designer"))).toEqual(["16 Nov 2026", "3 of 7", "2", "5", "2", "1", "4"]);
    // The company: how many of its people were active, and the sums.
    const acme = rowOf(table, "Acme Fire");
    expect(acme).toHaveTextContent("2 people");
    expect(cells(acme)).toEqual(["16 Nov 2026", "1 of 2", "2", "5", "2", "1", "4"]);
    expect(rowOf(table, "No name yet")).toHaveTextContent("vee@acme.test · deactivated");
    const solo = rowOf(table, "Individual accounts");
    expect(solo).toHaveTextContent("1 person");
    expect(cells(solo)).toEqual(["Never", "0 of 1", "0", "0", "0", "0", "0"]);
  });

  it("links to the four-week view and marks the current one", () => {
    render(<ActivityScreen scope="platform" view="week" basePath="/admin/activity" rows={ROWS} />);
    const views = screen.getByRole("navigation", { name: "View" });
    expect(within(views).getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
    expect(within(views).getByRole("link", { name: "Four weeks" })).toHaveAttribute("href", "/admin/activity?view=weeks");
    expect(screen.getByText(/Days active: days this week with a saved markup/)).toBeInTheDocument();
  });
});

describe("ActivityScreen, four weeks", () => {
  it("compares markups and PDFs week by week", () => {
    render(<ActivityScreen scope="platform" view="weeks" basePath="/admin/activity" rows={ROWS} />);
    const table = screen.getByRole("table", { name: "Activity by company and account, the last four weeks" });
    expect(within(table).getByRole("columnheader", { name: "Markups saved" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "PDFs exported" })).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader", { name: "3 weeks ago" })).toHaveLength(2);
    // Markups: this week, last, 2 and 3 weeks ago, all time; PDFs: the same four weeks.
    expect(cells(rowOf(table, "Pat Designer"))).toEqual(["5", "3", "0", "1", "40", "2", "0", "1", "0"]);
    expect(cells(rowOf(table, "Acme Fire"))).toEqual(["5", "3", "0", "1", "42", "2", "0", "1", "0"]);
    const views = screen.getByRole("navigation", { name: "View" });
    expect(within(views).getByRole("link", { name: "Four weeks" })).toHaveAttribute("aria-current", "page");
    expect(within(views).getByRole("link", { name: "This week" })).toHaveAttribute("href", "/admin/activity");
  });
});

describe("ActivityScreen, a company", () => {
  it("shows a company admin their own company under one heading", () => {
    render(<ActivityScreen scope="company" view="week" basePath="/company/activity" companyName="Acme Fire" rows={ROWS.slice(0, 2)} />);
    const table = screen.getByRole("table", { name: "Activity of Acme Fire, this week" });
    expect(rowOf(table, "Whole company")).toHaveTextContent("2 people");
    expect(within(table).queryByText("Acme Fire")).toBeNull();
    expect(screen.getByText(/How much the people of Acme Fire used Plan Markup/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Four weeks" })).toHaveAttribute("href", "/company/activity?view=weeks");
  });

  it("says so when there is nothing, and formats a missing or broken time as Never", () => {
    render(<ActivityScreen scope="platform" view="week" basePath="/admin/activity" rows={[]} />);
    expect(screen.getByText("No accounts yet.")).toBeInTheDocument();
    expect(lastActive(null)).toBe("Never");
    expect(lastActive("not a date")).toBe("Never");
    expect(lastActive("2026-11-15T22:00:00Z")).toBe("16 Nov 2026");
  });
});
