// Story 9.3: the use -> hazard mapping in this session. The built-in one until
// the server's is read (once per session; a failure keeps the built-in one).
// No editor imports: the editor's zone mode reads it for a new zone's use.
import { createStore } from "zustand/vanilla";

import type { ResolvedUseMap } from "@/core/sprinkler/use-map";
import { USE_HAZARD_V1 } from "@/core/sprinkler/rules/rules";

export const useMapStore = createStore<ResolvedUseMap & { loaded: boolean }>(() => ({ map: USE_HAZARD_V1, source: "built-in", loaded: false }));

let loading: Promise<void> | null = null;

/** Reads the mapping once (`fetch`: the server action). */
export function loadUseMap(fetch: () => Promise<{ ok: true; data: ResolvedUseMap } | { ok: false }>): Promise<void> {
  if (useMapStore.getState().loaded) return Promise.resolve();
  loading ??= fetch()
    .then((r) => {
      if (r.ok) useMapStore.setState({ ...r.data, loaded: true });
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function resetUseMap(): void {
  useMapStore.setState({ map: USE_HAZARD_V1, source: "built-in", loaded: false }, true);
  loading = null;
}
