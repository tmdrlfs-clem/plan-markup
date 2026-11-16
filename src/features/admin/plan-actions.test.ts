import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPlatformAdmin: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getPlatformAdmin: m.getPlatformAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { asPlan } from "@/lib/plans";
import { setPlan } from "./plan-actions";

const ADMIN = { id: "00000000-0000-4000-8000-00000000000a", isPlatformAdmin: true };
const TARGET = "00000000-0000-4000-8000-00000000000c";

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlatformAdmin.mockResolvedValue(ADMIN);
  m.rpc.mockResolvedValue({ data: [{ previous_plan: "trial" }], error: null });
});

describe("setPlan", () => {
  it("sets a user's plan through the audited function, as the signed-in admin", async () => {
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot" })).toEqual({ ok: true, data: { plan: "pilot", changed: true } });
    expect(m.rpc).toHaveBeenCalledWith("admin_set_plan", { p_actor_id: ADMIN.id, p_target_type: "user", p_target_id: TARGET, p_plan: "pilot" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it("sets a company's plan, and reports an unchanged one", async () => {
    expect(await setPlan({ targetType: "company", targetId: TARGET, plan: "trial" })).toEqual({ ok: true, data: { plan: "trial", changed: false } });
    expect(m.rpc).toHaveBeenCalledWith("admin_set_plan", expect.objectContaining({ p_target_type: "company" }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });

  it("refuses everyone but the platform admin, and bad input, before touching the database", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "enterprise" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setPlan({ targetType: "drawing", targetId: TARGET, plan: "pilot" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setPlan({ targetType: "user", targetId: "nope", plan: "pilot" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot", status: "active" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals and hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await setPlan({ targetType: "company", targetId: TARGET, plan: "pilot" })).toMatchObject({ ok: false, code: "NOT_FOUND", message: "This company no longer exists." });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
    m.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await setPlan({ targetType: "user", targetId: TARGET, plan: "pilot" })).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});

describe("asPlan", () => {
  it("reads a stored value, and anything unknown as the default", () => {
    expect(asPlan("standard")).toBe("standard");
    expect(asPlan("gold")).toBe("trial");
    expect(asPlan(null)).toBe("trial");
  });
});
