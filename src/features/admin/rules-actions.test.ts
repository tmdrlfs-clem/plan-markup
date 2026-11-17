import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPlatformAdmin: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getPlatformAdmin: m.getPlatformAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { NZS4541_V1 } from "@/core/sprinkler/rules/rules";

import { confirmDefaultUseMap, confirmRuleFigures, saveDefaultUseMap, saveRuleFigures } from "./rules-actions";

const ADMIN = { id: "00000000-0000-4000-8000-00000000000a", isPlatformAdmin: true };
const FIGURES = { hazards: { ...NZS4541_V1.hazards, ELH: { ...NZS4541_V1.hazards.ELH, Amax: 20 } }, source: "  Clause 5 correction  " };
const MAP = {
  defaultUse: "Lab",
  uses: [
    { use: " Office ", hazard: "ELH" },
    { use: "Lab", hazard: "OH3" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlatformAdmin.mockResolvedValue(ADMIN);
});

describe("saveRuleFigures (Story 10.13)", () => {
  it("adds the next version through the audited function, as the signed-in admin", async () => {
    m.rpc.mockResolvedValue({ data: [{ changed: true, version: "2" }], error: null });
    expect(await saveRuleFigures(FIGURES)).toEqual({ ok: true, data: { changed: true, version: "2" } });
    expect(m.rpc).toHaveBeenCalledWith("admin_create_rule_figures", {
      p_actor_id: ADMIN.id,
      p_ruleset_id: "nzs4541",
      p_hazards: FIGURES.hazards,
      p_source: "Clause 5 correction",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/rules");
  });

  it("reports figures that already are the newest version's", async () => {
    m.rpc.mockResolvedValue({ data: [{ changed: false, version: "1" }], error: null });
    expect(await saveRuleFigures({ hazards: NZS4541_V1.hazards, source: "Same" })).toEqual({ ok: true, data: { changed: false, version: "1" } });
  });

  it("refuses everyone but the platform admin, and bad figures, before touching the database", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await saveRuleFigures(FIGURES)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const bad = (change: object, source = "x") => saveRuleFigures({ hazards: { ...FIGURES.hazards, OH1: { ...FIGURES.hazards.OH1, ...change } }, source });
    expect(await bad({ Smin: 4 })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "hazards.OH1.Smin", message: "Min spacing must be below max spacing." });
    expect(await bad({ Wmin: 2 })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "hazards.OH1.Wmin" });
    expect(await bad({ Amax: 0 })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "hazards.OH1.Amax", message: "Must be above 0." });
    expect(await bad({ Amax: 101 })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "hazards.OH1.Amax" });
    expect(await bad({ Smax: Number.NaN })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "hazards.OH1.Smax" });
    expect(await bad({ extra: 1 })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await bad({}, "   ")).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "source", message: "Say where the figures come from." });
    expect(await saveRuleFigures({ ...FIGURES, verified: true })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals and hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await saveRuleFigures(FIGURES)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect(await saveRuleFigures(FIGURES)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const r = await saveRuleFigures(FIGURES);
    expect(r).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(r)).not.toContain("secret");
    m.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await saveRuleFigures(FIGURES)).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});

describe("confirmRuleFigures (Story 10.13)", () => {
  it("confirms the version through the audited function", async () => {
    m.rpc.mockResolvedValue({ data: [{ changed: true }], error: null });
    expect(await confirmRuleFigures({ version: "2" })).toEqual({ ok: true, data: { changed: true } });
    expect(m.rpc).toHaveBeenCalledWith("admin_verify_rule_figures", { p_actor_id: ADMIN.id, p_ruleset_id: "nzs4541", p_version: "2" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/rules");
  });

  it("refuses others and bad input; says when a newer version exists", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await confirmRuleFigures({ version: "2" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await confirmRuleFigures({ version: "two" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await confirmRuleFigures({ version: "2", rulesetId: "other" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await confirmRuleFigures({ version: "2" })).toMatchObject({ ok: false, code: "CONFLICT", message: "A newer version has been added since. Check it before confirming." });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await confirmRuleFigures({ version: "9" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("the platform default mapping (Story 10.13)", () => {
  it("saves the whole mapping through the audited function", async () => {
    m.rpc.mockResolvedValue({ data: [{ changed: true, map_version: "2" }], error: null });
    expect(await saveDefaultUseMap(MAP)).toEqual({ ok: true, data: { changed: true, version: "2" } });
    expect(m.rpc).toHaveBeenCalledWith("admin_set_default_use_hazard_map", {
      p_actor_id: ADMIN.id,
      p_uses: [
        { use: "Office", hazard: "ELH", is_default: false },
        { use: "Lab", hazard: "OH3", is_default: true },
      ],
    });
  });

  it("refuses others and a bad mapping before touching the database", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await saveDefaultUseMap(MAP)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await saveDefaultUseMap({ ...MAP, defaultUse: "Nope" })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "defaultUse" });
    expect(await saveDefaultUseMap({ defaultUse: "Lab", uses: [{ use: "Lab", hazard: "HH" }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("confirms the version the admin looked at; says when it has changed since", async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ changed: true }], error: null });
    expect(await confirmDefaultUseMap({ version: "2" })).toEqual({ ok: true, data: { changed: true } });
    expect(m.rpc).toHaveBeenCalledWith("admin_verify_default_use_hazard_map", { p_actor_id: ADMIN.id, p_version: "2" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await confirmDefaultUseMap({ version: "1" })).toMatchObject({ ok: false, code: "CONFLICT" });
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await confirmDefaultUseMap({ version: "2" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
