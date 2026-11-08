import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getAuthUser: vi.fn(), limit: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: (table: string) => {
      expect(table).toBe("use_hazard_map");
      return { select: () => ({ order: () => ({ limit: m.limit }) }) };
    },
  }),
}));

import { USE_HAZARD_V1 } from "@/core/sprinkler/rules/rules";

import { getUseHazardMap } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.test", name: "A", isPlatformAdmin: false, theme: "blueprint" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
});

describe("getUseHazardMap (Story 9.3)", () => {
  it("returns the platform rows' mapping (no companies until M3)", async () => {
    m.limit.mockResolvedValue({
      data: [
        { company_id: "c0000000-0000-4000-8000-000000000001", map_version: "2", use: "Office", hazard: "OH3", is_default: true, verified: true },
        { company_id: null, map_version: "1", use: "Office", hazard: "ELH", is_default: true, verified: false },
        { company_id: null, map_version: "1", use: "Plant", hazard: "OH1", is_default: false, verified: false },
      ],
      error: null,
    });
    const r = await getUseHazardMap();
    expect(r).toMatchObject({ ok: true, data: { source: "platform", map: { defaultUse: "Office", uses: [{ use: "Office", hazard: "ELH" }, { use: "Plant", hazard: "OH1" }] } } });
  });

  it("falls back to the built-in map with no rows; refuses without a user; hides errors", async () => {
    m.limit.mockResolvedValue({ data: [], error: null });
    await expect(getUseHazardMap()).resolves.toEqual({ ok: true, data: { map: USE_HAZARD_V1, source: "built-in" } });
    m.getAuthUser.mockResolvedValue(null);
    await expect(getUseHazardMap()).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    m.getAuthUser.mockResolvedValue(USER);
    m.limit.mockResolvedValue({ data: null, error: { code: "42501", message: "secret detail" } });
    const r = await getUseHazardMap();
    expect(r).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
