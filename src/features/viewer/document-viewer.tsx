"use client";

import { useEffect } from "react";
import { useStore } from "zustand";

import { dismissHint, showHint } from "@/components/ui/hint-store";

import { CanvasViewport, type CanvasViewportProps } from "./canvas-viewport";
import { dismissNotice, viewerStore } from "./viewer-store";

export const IMAGE_ONLY_HINT_ID = "image-only";
export const IMAGE_ONLY_HINT =
  "This page is an image — snapping and scale detection are unavailable; calibrate manually";
export const MEMORY_HINT_ID = "memory";
export const MEMORY_HINT = "This drawing is using a lot of memory — some areas may redraw as you move";
const APP_TITLE = "Plan Markup";

/** The open drawing: canvas viewport plus the document-level side effects (title, HintBar). */
export function DocumentViewer(props: CanvasViewportProps) {
  const fileName = useStore(viewerStore, (s) => s.fileName);
  const status = useStore(viewerStore, (s) => s.status);
  const imageOnly = useStore(viewerStore, (s) => s.content?.imageOnly === true);
  const openSeq = useStore(viewerStore, (s) => s.openSeq);
  const memoryPressure = useStore(viewerStore, (s) => s.memoryPressure);

  // Window title "<file name> — Plan Markup" while a drawing is shown (AC 8).
  const shown = status !== "error" && fileName !== null;
  useEffect(() => {
    if (!shown) return;
    const previous = document.title;
    document.title = `${fileName} — ${APP_TITLE}`;
    return () => {
      document.title = previous;
    };
  }, [shown, fileName]);

  // Image-only page notice (UX-DR11, UX-DR31): shown once per document; a new
  // document clears it. Dismiss keeps it hidden for this one, also when its tab
  // is shown again (the dismissal is kept in the tab's state, Story 3.5).
  const imageOnlyDismissed = useStore(viewerStore, (s) => s.dismissedNotices.includes(IMAGE_ONLY_HINT_ID));
  useEffect(() => {
    if (imageOnly && !imageOnlyDismissed) {
      showHint({ id: IMAGE_ONLY_HINT_ID, variant: "info", text: IMAGE_ONLY_HINT, onDismiss: () => dismissNotice(IMAGE_ONLY_HINT_ID) });
    }
    return () => dismissHint(IMAGE_ONLY_HINT_ID);
  }, [imageOnly, imageOnlyDismissed, openSeq]);

  // Memory warning (AC 5, UX-DR31): once per document, when the tile budget ran out.
  const memoryDismissed = useStore(viewerStore, (s) => s.dismissedNotices.includes(MEMORY_HINT_ID));
  useEffect(() => {
    if (memoryPressure && !memoryDismissed) {
      showHint({ id: MEMORY_HINT_ID, variant: "warning", text: MEMORY_HINT, onDismiss: () => dismissNotice(MEMORY_HINT_ID) });
    }
    return () => dismissHint(MEMORY_HINT_ID);
  }, [memoryPressure, memoryDismissed, openSeq]);

  return <CanvasViewport {...props} />;
}
