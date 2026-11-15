import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPlatformAdmin: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getPlatformAdmin: m.getPlatformAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { createCompany } from "./company-actions";

const ADMIN = { id: "00000000-0000-4000-8000-00000000000a", email: "admin@plan-markup.test", name: "Admin", isPlatformAdmin: true };
const COMPANY_ID = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlatformAdmin.mockResolvedValue(ADMIN);
  m.rpc.mockResolvedValue({ data: [{ company_id: COMPANY_ID, admin_user_id: "u" }], error: null });
});

describe("createCompany", () => {
  it("creates through the audited function, as the signed-in admin", async () => {
    expect(await createCompany({ name: "  Acme Fire ", adminEmail: " Pat@Plan-Markup.test " })).toEqual({
      ok: true,
      data: { id: COMPANY_ID, name: "Acme Fire" },
    });
    expect(m.rpc).toHaveBeenCalledWith("admin_create_company", {
      p_actor_id: ADMIN.id,
      p_name: "Acme Fire",
      p_admin_email: "pat@plan-markup.test",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });

  it("refuses everyone but the platform admin before touching the database", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("names the field of a bad value, and refuses extra fields", async () => {
    expect(await createCompany({ name: "  ", adminEmail: "pat@plan-markup.test" })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "name" });
    expect(await createCompany({ name: "a".repeat(101), adminEmail: "pat@plan-markup.test" })).toMatchObject({ field: "name" });
    expect(await createCompany({ name: "Acme", adminEmail: "not-an-email" })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "adminEmail" });
    const extra = await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test", plan: "standard" });
    expect(extra).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(extra).not.toHaveProperty("field");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals to the field they are about", async () => {
    const cases: [string, object][] = [
      ["PT404", { code: "NOT_FOUND", field: "adminEmail" }],
      ["PT422", { code: "CONFLICT", field: "adminEmail" }],
      ["PT409", { code: "CONFLICT", field: "adminEmail" }],
      ["23505", { code: "CONFLICT", field: "name" }],
    ];
    for (const [code, expected] of cases) {
      m.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "detail" } });
      expect(await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test" })).toMatchObject({ ok: false, ...expected });
    }
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403", message: "x" } });
    expect(await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
    m.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await createCompany({ name: "Acme", adminEmail: "pat@plan-markup.test" })).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});
