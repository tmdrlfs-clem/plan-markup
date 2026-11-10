// Story 9.10 / 9.11: the live check's results for the shown page, and the rule
// break in focus (a row in the ZoneReport, a marker on the canvas). No editor
// imports: the editor paints the markers from here (live-check.ts fills it).
import { createStore } from "zustand/vanilla";

import type { OracleReport } from "@/core/sprinkler/oracle";
import { notifyMarkups } from "@/features/viewer";

/** A rule break: the zone and the index of the flag in its report. */
export type FlagRef = { zoneId: string; index: number };

export type ZoneCheckState = {
  /** The page the reports are for. */
  pageId: string | null;
  /** The oracle's latest report per zone id (zones with heads only). */
  reports: Readonly<Record<string, OracleReport>>;
  /** Story 9.11: the rule break selected (its row and its marker are highlighted). */
  focus: FlagRef | null;
};

export const EMPTY_CHECKS: ZoneCheckState = { pageId: null, reports: {}, focus: null };
export const zoneCheckStore = createStore<ZoneCheckState>(() => EMPTY_CHECKS);

/** Every change repaints the canvas (the markers). */
export function setChecks(patch: Partial<ZoneCheckState>, replace = false): void {
  if (replace) zoneCheckStore.setState({ ...EMPTY_CHECKS, ...patch }, true);
  else zoneCheckStore.setState(patch);
  notifyMarkups({});
}

export function setFlagFocus(focus: FlagRef | null): void {
  const f = zoneCheckStore.getState().focus;
  if (f === focus || (f && focus && f.zoneId === focus.zoneId && f.index === focus.index)) return;
  setChecks({ focus });
}
