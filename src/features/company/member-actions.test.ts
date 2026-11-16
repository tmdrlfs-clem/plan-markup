import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getCompanyAdmin: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("./guard", () => ({ getCompanyAdmin: m.getCompanyAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { changeMemberRole, removeMember } from "./member-actions";

const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "00000000-0000-4000-8000-00000000000c";
const ADMIN = { user: { id: ADMIN_ID, email: "boss@acme.test", name: "Bo Boss" }, membership: { companyId: "c1", companyName: "Acme Fire", role: "admin" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.getCompanyAdmin.mockResolvedValue(ADMIN);
  m.rpc.mockResolvedValue({ data: [{ previous_role: "viewer" }], error: null });
});

describe("changeMemberRole", () => {
  it("changes through the audited function, as the signed-in admin", async () => {
    expect(await changeMemberRole({ userId: USER_ID, role: "member" })).toEqual({ ok: true, data: { role: "member", changed: true, self: false } });
    expect(m.rpc).toHaveBeenCalledWith("set_company_member_role", { p_actor_id: ADMIN_ID, p_user_id: USER_ID, p_role: "member" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/company/members");
  });

  it("reports an unchanged role, and the admin's own change", async () => {
    expect(await changeMemberRole({ userId: USER_ID, role: "viewer" })).toMatchObject({ ok: true, data: { changed: false, self: false } });
    m.rpc.mockResolvedValueOnce({ data: [{ previous_role: "admin" }], error: null });
    expect(await changeMemberRole({ userId: ADMIN_ID, role: "member" })).toMatchObject({ ok: true, data: { changed: true, self: true } });
  });

  it("refuses non-admins and bad input before touching the database", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await changeMemberRole({ userId: USER_ID, role: "member" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeMemberRole({ userId: "nope", role: "member" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeMemberRole({ userId: USER_ID, role: "owner" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeMemberRole({ userId: USER_ID, role: "member", companyId: "c2" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals and hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await changeMemberRole({ userId: USER_ID, role: "member" })).toMatchObject({ ok: false, code: "CONFLICT", message: expect.stringContaining("at least one active admin") });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await changeMemberRole({ userId: USER_ID, role: "member" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await changeMemberRole({ userId: USER_ID, role: "member" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await changeMemberRole({ userId: USER_ID, role: "member" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });
});

describe("removeMember", () => {
  it("removes through the audited function, and reports the admin's own leaving", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await removeMember({ userId: USER_ID })).toEqual({ ok: true, data: { self: false } });
    expect(m.rpc).toHaveBeenCalledWith("remove_company_member", { p_actor_id: ADMIN_ID, p_user_id: USER_ID });
    expect(await removeMember({ userId: ADMIN_ID })).toEqual({ ok: true, data: { self: true } });
  });

  it("refuses non-admins and bad input, and maps the function's refusals", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await removeMember({ userId: USER_ID })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await removeMember({ userId: "nope" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await removeMember({ userId: USER_ID })).toMatchObject({ ok: false, code: "CONFLICT" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await removeMember({ userId: USER_ID })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await removeMember({ userId: USER_ID })).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});
