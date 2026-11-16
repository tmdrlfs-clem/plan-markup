// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { isAccountId, lookupMarkupSets, type SupportSet } from "@/lib/db/support-lookup";
import { SupportScreen } from "./support-screen";

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const USER = "00000000-0000-4000-8000-00000000000c";

const SETS: SupportSet[] = [
  { id: "d1", filename: "L3 RCP Rev B.pdf", pageCount: 6, fileCount: 2, markupCount: 14, createdAt: "2026-11-10T00:00:00Z", lastSavedAt: "2026-11-15T22:30:00Z" },
  { id: "d2", filename: "Untitled set", pageCount: null, fileCount: 0, markupCount: 0, createdAt: "2026-11-01T00:00:00Z", lastSavedAt: null },
];

beforeEach(() => vi.clearAllMocks());

describe("lookupMarkupSets", () => {
  it("calls the audited function as the admin and maps names and counts", async () => {
    m.rpc.mockResolvedValue({
      data: [
        { drawing_id: "d1", filename: "L3 RCP Rev B.pdf", page_count: 6, file_count: 2, markup_count: 14, created_at: "2026-11-10T00:00:00Z", last_saved_at: "2026-11-15T22:30:00Z" },
      ],
      error: null,
    });
    expect(await lookupMarkupSets(ADMIN, USER)).toEqual({ kind: "ok", sets: [SETS[0]] });
    expect(m.rpc).toHaveBeenCalledWith("admin_lookup_markup_sets", { p_actor_id: ADMIN, p_user_id: USER });
  });

  it("maps the function's refusals and throws on anything else", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await lookupMarkupSets(ADMIN, USER)).toEqual({ kind: "forbidden" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await lookupMarkupSets(ADMIN, USER)).toEqual({ kind: "not_found" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    await expect(lookupMarkupSets(ADMIN, USER)).rejects.toThrow("Could not look up the markup sets: XX000");
  });

  it("accepts only account ids as the route parameter", () => {
    expect(isAccountId(USER)).toBe(true);
    expect(isAccountId("support")).toBe(false);
    expect(isAccountId(`${USER}/../x`)).toBe(false);
  });
});

describe("SupportScreen", () => {
  it("lists each set by file name, pages, markups and last save, and says the lookup is recorded", () => {
    render(<SupportScreen account={{ name: "Pat Designer", email: "pat@acme.test", status: "active" }} sets={SETS} />);
    expect(screen.getByRole("heading", { name: "Markup sets of Pat Designer" })).toBeInTheDocument();
    expect(screen.getByText("pat@acme.test · Active")).toBeInTheDocument();
    expect(screen.getByText(/This lookup has been recorded in the audit log/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Markup sets of Pat Designer" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["File name", "Pages", "Markups", "Last saved"]);
    const first = within(table).getByRole("row", { name: /L3 RCP Rev B\.pdf/ });
    expect(first).toHaveTextContent("2 file versions; the newest is shown");
    expect(within(first).getAllByRole("cell").map((c) => c.textContent)).toEqual(["6", "14", "16 Nov 2026, 11:30 am"]);
    const second = within(table).getByRole("row", { name: /Untitled set/ });
    expect(within(second).getAllByRole("cell").map((c) => c.textContent)).toEqual(["No file", "0", ""]);
    expect(screen.getByRole("status")).toHaveTextContent("2 markup sets");
    // Nothing leads to a drawing: the only link goes back to the accounts.
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/admin/users?status=all"]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the email when there is no name, and says so when there are no sets", () => {
    render(<SupportScreen account={{ name: " ", email: "new@acme.test", status: "pending" }} sets={[]} />);
    expect(screen.getByRole("heading", { name: "Markup sets of new@acme.test" })).toBeInTheDocument();
    expect(screen.getByText("new@acme.test · Waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("This account has no markup sets.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 markup sets");
  });
});
