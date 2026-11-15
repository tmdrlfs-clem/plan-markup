// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ setUserStatus: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("./actions", () => ({ setUserStatus: m.setUserStatus }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import { ilikePattern, parseAdminUserQuery, type AdminUserList, type AdminUserRow } from "@/lib/db/admin-users";
import { UsersScreen, usersHref } from "./users-screen";

const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";

function row(over: Partial<AdminUserRow>): AdminUserRow {
  return { id: "00000000-0000-4000-8000-00000000000c", name: "Pat Pending", email: "pat@plan-markup.test", status: "pending", isPlatformAdmin: false, createdAt: "2026-11-15T22:00:00Z", ...over };
}

function list(rows: AdminUserRow[], total = rows.length): AdminUserList {
  return { rows, total, counts: { pending: 1, active: 2, deactivated: 0 } };
}

beforeEach(() => vi.clearAllMocks());

describe("parseAdminUserQuery / usersHref / ilikePattern", () => {
  it("falls back to the defaults for anything unknown", () => {
    expect(parseAdminUserQuery({})).toEqual({ filter: "pending", search: "", page: 1 });
    expect(parseAdminUserQuery({ status: "owner", q: ["  pat  ", "x"], page: "-3" })).toEqual({ filter: "pending", search: "pat", page: 1 });
    expect(parseAdminUserQuery({ status: "all", q: "a".repeat(300), page: "4" })).toEqual({ filter: "all", search: "a".repeat(100), page: 4 });
  });

  it("builds links that leave the defaults out", () => {
    expect(usersHref({ filter: "pending", search: "", page: 1 })).toBe("/admin/users");
    expect(usersHref({ filter: "active", search: "a b&c", page: 2 })).toBe("/admin/users?status=active&q=a+b%26c&page=2");
  });

  it("matches %, _ and \\ in a search literally", () => {
    expect(ilikePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});

describe("UsersScreen", () => {
  it("lists accounts with status, sign-up date and the right action", () => {
    render(
      <UsersScreen
        adminId={ADMIN_ID}
        query={{ filter: "all", search: "", page: 1 }}
        list={list([
          row({}),
          row({ id: "00000000-0000-4000-8000-00000000000b", name: "", email: "active@plan-markup.test", status: "active" }),
          row({ id: ADMIN_ID, name: "Dev Admin", email: "admin@plan-markup.test", status: "active", isPlatformAdmin: true }),
          row({ id: "00000000-0000-4000-8000-00000000000d", name: "Dee", email: "dee@plan-markup.test", status: "deactivated" }),
        ])}
      />,
    );
    const pending = screen.getByRole("row", { name: /Pat Pending/ });
    expect(within(pending).getByText("Waiting")).toBeInTheDocument();
    expect(within(pending).getByText("16 Nov 2026")).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Activate Pat Pending" })).toBeInTheDocument();
    // No name: the email stands in for it in the action's name.
    expect(screen.getByRole("button", { name: "Deactivate active@plan-markup.test" })).toBeInTheDocument();
    // The admin's own row has no action.
    const self = screen.getByRole("row", { name: /Dev Admin/ });
    expect(within(self).queryByRole("button")).toBeNull();
    expect(within(self).getByText("You")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate Dee" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1–4 of 4 accounts");
  });

  it("marks the current filter, keeps the search in filter links and shows counts", () => {
    render(<UsersScreen adminId={ADMIN_ID} query={{ filter: "active", search: "pat", page: 1 }} list={list([])} />);
    const filters = screen.getByRole("navigation", { name: "Filter by status" });
    expect(within(filters).getByRole("link", { name: /^Active/ })).toHaveAttribute("aria-current", "page");
    expect(within(filters).getByRole("link", { name: /^Waiting for approval/ })).toHaveAttribute("href", "/admin/users?q=pat");
    expect(within(filters).getByRole("link", { name: /^All/ })).toHaveTextContent("3");
    expect(screen.getByText('No accounts here match "pat".')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/admin/users?status=active");
  });

  it("pages through a long list", () => {
    render(<UsersScreen adminId={ADMIN_ID} query={{ filter: "all", search: "", page: 2 }} list={list([row({})], 120)} />);
    expect(screen.getByRole("status")).toHaveTextContent("51–100 of 120 accounts");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/users?status=all");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/users?status=all&page=3");
  });

  it("activates at once and says whether the email went out", async () => {
    m.setUserStatus.mockResolvedValueOnce({ ok: true, data: { status: "active", changed: true, mail: "sent" } });
    render(<UsersScreen adminId={ADMIN_ID} query={{ filter: "pending", search: "", page: 1 }} list={list([row({})])} />);
    await userEvent.click(screen.getByRole("button", { name: "Activate Pat Pending" }));
    expect(m.setUserStatus).toHaveBeenCalledWith({ userId: "00000000-0000-4000-8000-00000000000c", status: "active" });
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: expect.stringContaining("email is on its way") }));
    expect(m.refresh).toHaveBeenCalled();

    m.setUserStatus.mockResolvedValueOnce({ ok: true, data: { status: "active", changed: true, mail: "not_configured" } });
    await userEvent.click(screen.getByRole("button", { name: "Activate Pat Pending" }));
    expect(m.toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "warning", title: expect.stringContaining("was not sent") }));
  });

  it("asks before deactivating, and shows a refusal", async () => {
    render(<UsersScreen adminId={ADMIN_ID} query={{ filter: "active", search: "", page: 1 }} list={list([row({ name: "Ann", status: "active" })])} />);
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Ann" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Deactivate this account?" });
    expect(dialog).toHaveTextContent("Ann is signed out at once");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(m.setUserStatus).not.toHaveBeenCalled();

    m.setUserStatus.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND", message: "This account no longer exists." });
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Ann" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate account" }));
    expect(m.setUserStatus).toHaveBeenCalledWith({ userId: "00000000-0000-4000-8000-00000000000c", status: "deactivated" });
    expect(m.toast).toHaveBeenCalledWith({ variant: "danger", title: "This account no longer exists." });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
