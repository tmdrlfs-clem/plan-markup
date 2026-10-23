import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: (table: string) => {
      expect(table).toBe("profiles");
      return { update: m.update };
    },
  }),
}));

import { setTheme } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue({ id: "u1", email: "a@b.test", name: "", isPlatformAdmin: false, theme: "blueprint" });
  m.update.mockReturnValue({ eq: m.eq });
  m.eq.mockReturnValue({ select: m.select });
  m.select.mockResolvedValue({ data: [{ theme: "daylight" }], error: null });
});

describe("setTheme", () => {
  it("stores the theme on the caller's own profile (the id comes from the session)", async () => {
    await expect(setTheme("daylight")).resolves.toEqual({ ok: true, data: { theme: "daylight" } });
    expect(m.update).toHaveBeenCalledWith({ theme: "daylight" });
    expect(m.eq).toHaveBeenCalledWith("id", "u1");
  });

  it("refuses without an active user and never touches the database", async () => {
    m.getAuthUser.mockResolvedValue(null);
    await expect(setTheme("daylight")).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each([["neon"], [""], [null], [{ theme: "daylight" }], ["Blueprint"]])("rejects %j as INVALID_INPUT", async (value) => {
    await expect(setTheme(value)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("a database error is INTERNAL with the safe message, logged without details", async () => {
    m.select.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table profiles" } });
    const result = await setTheme("contrast");
    expect(result).toEqual({ ok: false, code: "INTERNAL", message: "Something went wrong on our side. Try again shortly." });
    expect(m.error).toHaveBeenCalledWith("appearance.set_theme_failed", expect.anything());
  });

  it("no row updated (RLS) is NOT_FOUND", async () => {
    m.select.mockResolvedValue({ data: [], error: null });
    await expect(setTheme("contrast")).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
