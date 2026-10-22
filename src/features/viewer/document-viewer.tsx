"use client";

import { useEffect } from "react";
import { useStore } from "zustand";

import { dismissHint, showHint } from "@/components/ui/hint-store";

import { CanvasViewport, type CanvasViewportProps } from "./canvas-viewport";
import { viewerStore } from "./viewer-store";

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
  // document clears it, Dismiss keeps it hidden for this one.
  useEffect(() => {
    if (imageOnly) showHint({ id: IMAGE_ONLY_HINT_ID, variant: "info", text: IMAGE_ONLY_HINT });
    return () => dismissHint(IMAGE_ONLY_HINT_ID);
  }, [imageOnly, openSeq]);

  // Memory warning (AC 5, UX-DR31): once per document, when the tile budget ran out.
  useEffect(() => {
    if (memoryPressure) showHint({ id: MEMORY_HINT_ID, variant: "warning", text: MEMORY_HINT });
    return () => dismissHint(MEMORY_HINT_ID);
  }, [memoryPressure, openSeq]);

  return <CanvasViewport {...props} />;
}
