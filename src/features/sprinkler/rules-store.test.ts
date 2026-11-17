import { afterEach, describe, expect, it, vi } from "vitest";

import { NZS4541_V1, type RuleSet } from "@/core/sprinkler/rules/rules";
import { coverageStore, resetCoverage } from "@/features/editor/coverage-overlay";

import { loadRules, resetRules, rulesStore } from "./rules-store";

const V2: RuleSet = { ...NZS4541_V1, version: "2", hazards: { ...NZS4541_V1.hazards, ELH: { ...NZS4541_V1.hazards.ELH, Amax: 20 } } };

afterEach(() => {
  resetRules();
  resetCoverage();
});

describe("rulesStore (Story 10.13)", () => {
  it("starts from the built-in figures and reads the ones in use once", async () => {
    expect(rulesStore.getState()).toEqual({ rules: NZS4541_V1, loaded: false });
    const fetch = vi.fn(async () => ({ ok: true as const, data: V2 }));
    await Promise.all([loadRules(fetch), loadRules(fetch)]);
    await loadRules(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rulesStore.getState()).toEqual({ rules: V2, loaded: true });
    // The coverage overlay follows the same figures.
    expect(coverageStore.getState().rules).toEqual(V2);
  });

  it("keeps the built-in figures when the read fails, and tries again next time", async () => {
    await loadRules(async () => ({ ok: false as const }));
    await loadRules(async () => {
      throw new Error("offline");
    });
    expect(rulesStore.getState()).toEqual({ rules: NZS4541_V1, loaded: false });
    await loadRules(async () => ({ ok: true as const, data: V2 }));
    expect(rulesStore.getState().rules.version).toBe("2");
  });

  it("never uses a draft, or anything that does not read as a rule set", async () => {
    await loadRules(async () => ({ ok: true as const, data: { ...V2, verified: false } }));
    expect(rulesStore.getState()).toEqual({ rules: NZS4541_V1, loaded: false });
    await loadRules(async () => ({ ok: true as const, data: { ...V2, hazards: { ELH: { Amax: -1 } } } }));
    expect(rulesStore.getState()).toEqual({ rules: NZS4541_V1, loaded: false });
    expect(coverageStore.getState().rules).toEqual(NZS4541_V1);
  });
});
