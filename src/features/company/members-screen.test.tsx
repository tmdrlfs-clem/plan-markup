// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ inviteMember: vi.fn(), revokeInvitation: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("./actions", () => ({ inviteMember: m.inviteMember, revokeInvitation: m.revokeInvitation }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import type { CompanyInvitation, CompanyMember } from "@/lib/db/companies";
import { hashInviteToken, invitePath, newInviteToken, parseInviteToken } from "@/lib/invite-token";
import { MembersScreen } from "./members-screen";

const ME = "00000000-0000-4000-8000-00000000000a";
const MEMBERS: CompanyMember[] = [
  { userId: ME, name: "Bo Boss", email: "boss@acme.test", role: "admin", joinedAt: "2026-11-15T22:00:00Z" },
  { userId: "u2", name: "", email: "vee@acme.test", role: "viewer", joinedAt: "2026-11-16T22:00:00Z" },
];
const INVITATIONS: CompanyInvitation[] = [
  { id: "i1", email: "pat@acme.test", role: "member", createdAt: "2026-11-16T00:00:00Z", expiresAt: "2026-11-23T00:00:00Z", expired: false },
  { id: "i2", email: "old@acme.test", role: "viewer", createdAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-08T00:00:00Z", expired: true },
];

function show(invitations = INVITATIONS) {
  render(<MembersScreen companyName="Acme Fire" currentUserId={ME} members={MEMBERS} invitations={invitations} />);
}

beforeEach(() => vi.clearAllMocks());

describe("invite token", () => {
  it("is 43 URL-safe characters, hashed with SHA-256, and parsed strictly", () => {
    const { token, hash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(newInviteToken().token).not.toBe(token);
    expect(parseInviteToken(token)).toBe(token);
    expect(parseInviteToken([token, "x"])).toBe(token);
    expect(parseInviteToken(`${token}x`)).toBeNull();
    expect(parseInviteToken("../../admin")).toBeNull();
    expect(parseInviteToken(undefined)).toBeNull();
    expect(invitePath(token)).toBe(`/invite?token=${token}`);
  });
});

describe("MembersScreen", () => {
  it("lists members with role and date, marking the signed-in admin", () => {
    show();
    const members = screen.getByRole("table", { name: "Members of Acme Fire" });
    const me = within(members).getByRole("row", { name: /Bo Boss/ });
    expect(within(me).getByText("You")).toBeInTheDocument();
    expect(within(me).getByText("Admin")).toBeInTheDocument();
    expect(within(me).getByText("16 Nov 2026")).toBeInTheDocument();
    const other = within(members).getByRole("row", { name: /vee@acme\.test/ });
    expect(within(other).getByText("No name yet")).toBeInTheDocument();
    expect(within(other).getByText("Viewer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Members (2)" })).toBeInTheDocument();
  });

  it("lists waiting invitations, flags an expired one, and says so when there are none", () => {
    show();
    const table = screen.getByRole("table", { name: /Invitations of Acme Fire/ });
    expect(within(within(table).getByRole("row", { name: /pat@acme\.test/ })).getByText("23 Nov 2026")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /old@acme\.test/ })).getByText("Expired 8 Nov 2026")).toBeInTheDocument();
  });

  it("says so when no invitation is waiting", () => {
    show([]);
    expect(screen.getByText("No invitations are waiting.")).toBeInTheDocument();
  });

  it("sends an invitation with the chosen role, clears the form and refreshes", async () => {
    m.inviteMember.mockResolvedValue({ ok: true, data: { email: "new@acme.test" } });
    show();
    expect(screen.getByText("Members create and edit markups.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Email"), "new@acme.test");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "viewer");
    expect(screen.getByText("Viewers look and comment, but do not draw.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(m.inviteMember).toHaveBeenCalledWith({ email: "new@acme.test", role: "viewer" });
    expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "Invitation sent to new@acme.test." });
    expect(m.refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Role")).toHaveValue("member");
  });

  it("shows a refusal about the person on the email field, and others as an alert", async () => {
    m.inviteMember.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "This person already belongs to another company.", field: "email" });
    show();
    const email = screen.getByLabelText("Email");
    await userEvent.type(email, "pat@other.test");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(email).toHaveAccessibleDescription("This person already belongs to another company.");
    expect(email).toHaveFocus();
    expect(email).toHaveValue("pat@other.test");

    m.inviteMember.mockResolvedValueOnce({ ok: false, code: "RATE_LIMITED", message: "Too many invitations. Try again in an hour." });
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Too many invitations.");
  });

  it("withdraws an invitation", async () => {
    m.revokeInvitation.mockResolvedValueOnce({ ok: true, data: { invitationId: "i1" } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw the invitation to pat@acme.test" }));
    expect(m.revokeInvitation).toHaveBeenCalledWith({ invitationId: "i1" });
    expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "The invitation to pat@acme.test is withdrawn." });
    expect(m.refresh).toHaveBeenCalled();

    m.revokeInvitation.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "This invitation was already accepted or withdrawn." });
    await userEvent.click(screen.getByRole("button", { name: "Withdraw the invitation to old@acme.test" }));
    expect(m.toast).toHaveBeenLastCalledWith({ variant: "danger", title: "This invitation was already accepted or withdrawn." });
  });
});
