// Story 9.8: where a Place heads run is saved (zone_layouts, A7) and reported
// (sprinkler.placed, FR80). Fire and forget: neither ever fails the run.

import { recordActivity } from "@/features/activity/actions";
import { markupSetIdOf } from "@/features/markup-set/sync";

import { saveZoneLayouts } from "./actions";
import type { RunSinks } from "./place-run";

export const serverRunSinks: RunSinks = {
  save: (documentId, layouts) => {
    void (async () => {
      const drawingId = await markupSetIdOf(documentId);
      if (drawingId) await saveZoneLayouts({ drawingId, layouts });
    })().catch(() => undefined);
  },
  record: (documentId, event) => {
    void (async () => {
      const drawingId = await markupSetIdOf(documentId);
      await recordActivity({ ...event, drawingId });
    })().catch(() => undefined);
  },
};
