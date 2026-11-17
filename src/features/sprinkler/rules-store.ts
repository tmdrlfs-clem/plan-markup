// Story 10.13 (A7): the rule figures in this session. The built-in ones until
// the server's are read (once per session; a failure keeps the built-in ones).
// Place heads, the live check, the coverage overlay and the zone's figures all
// read the same rule set from here.
import { createStore } from "zustand/vanilla";

import { NZS4541_V1, ruleSetSchema, type RuleSet } from "@/core/sprinkler/rules/rules";
import { setCoverageRules } from "@/features/editor";

export const rulesStore = createStore<{ rules: RuleSet; loaded: boolean }>(() => ({ rules: NZS4541_V1, loaded: false }));

let loading: Promise<void> | null = null;

/** Reads the rule set in use once (`fetch`: the server action). What does not read as a rule set is not used. */
export function loadRules(fetch: () => Promise<{ ok: true; data: unknown } | { ok: false }>): Promise<void> {
  if (rulesStore.getState().loaded) return Promise.resolve();
  loading ??= fetch()
    .then((r) => {
      if (!r.ok) return;
      const parsed = ruleSetSchema.safeParse(r.data);
      if (!parsed.success || !parsed.data.verified) return;
      rulesStore.setState({ rules: parsed.data, loaded: true });
      setCoverageRules(parsed.data);
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function resetRules(): void {
  rulesStore.setState({ rules: NZS4541_V1, loaded: false }, true);
  setCoverageRules(NZS4541_V1);
  loading = null;
}
