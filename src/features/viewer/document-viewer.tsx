"use client";

import { useEffect } from "react";
import { useStore } from "zustand";

import { dismissHint, showHint } from "@/components/ui/hint-store";

import { CanvasViewport, type CanvasViewportProps } from "./canvas-viewport";
import { viewerStore } from "./viewer-store";

export const IMAGE_ONLY_HINT_ID = "image-only";
export const IMAGE_ONLY_HINT =
  "This page is an image — snapping and scale detection are unavailable; calibrate manually";
const APP_TITLE = "Plan Markup";

/** The open drawing: canvas viewport plus the document-level side effects (title, HintBar). */
export function DocumentViewer(props: CanvasViewportProps) {
  const fileName = useStore(viewerStore, (s) => s.fileName);
  const status = useStore(viewerStore, (s) => s.status);
  const imageOnly = useStore(viewerStore, (s) => s.content?.imageOnly === true);
  const openSeq = useStore(viewerStore, (s) => s.openSeq);

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

  return <CanvasViewport {...props} />;
}
