"use client";

// The ScalePrompt (Story 4.7, FR82, UX J2 step 1): over the document area
// while a measuring tool is armed on a page with no scale. One detected scale:
// "Detected 1:100 @ A1 — Use it / Calibrate…"; otherwise only Calibrate…, with
// why. Non-modal: it never takes the focus, the canvas keeps its keys.

import { TriangleAlert, X } from "lucide-react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { viewerStore } from "@/features/viewer";

import { calibrateStore, openCalibrate } from "./calibrate-store";
import { applyDetectedScale, dismissScalePrompt, scalePromptFor, scalePromptStore, type ScalePrompt as Prompt } from "./scale-prompt-store";
import { verifyStore } from "./verify-store";

export const SCALE_PROMPT_NOTE = "Measurements show “Scale not set” until the page has a scale.";

/** The prompt's first line: what the page says about its scale. */
export function scalePromptText(prompt: Prompt): string {
  switch (prompt.state.kind) {
    case "detected":
      return `Detected ${prompt.state.label}`;
    case "conflict":
      return "Printed scales disagree";
    case "mixed":
      return `${prompt.state.count} scales on page`;
    default:
      return prompt.state.pending ? "Reading the drawing’s scale…" : "No scale found on this page";
  }
}

/** Mounted once by the workspace shell; renders nothing when no prompt is due. */
export function ScalePrompt() {
  const status = useStore(viewerStore, (s) => s.status);
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const tool = useStore(viewerStore, (s) => s.tool);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const pages = useStore(viewerStore, (s) => s.pages);
  const pageScales = useStore(viewerStore, (s) => s.pageScales);
  const calibrations = useStore(viewerStore, (s) => s.calibrations);
  const calibrate = useStore(calibrateStore, (s) => s.open);
  const verify = useStore(verifyStore, (s) => s.open);
  const dismissed = useStore(scalePromptStore, (s) => s.dismissed);
  const prompt = scalePromptFor(
    { status, pageCount, documentId, tool, pageIndex, pages, pageScales, calibrations },
    { calibrate, verify },
    dismissed,
  );
  if (!prompt) return null;
  return (
    <section
      aria-label="Scale not set"
      data-testid="scale-prompt"
      data-state={prompt.state.kind}
      className="fixed left-1/2 top-24 z-popover flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-sm border border-strong bg-surface-1 py-1 pl-3 pr-1 text-ws-md text-text shadow-2"
    >
      <TriangleAlert size={16} aria-hidden="true" className="shrink-0 text-warning-text" />
      <p role="status" aria-live="polite" className="min-w-0">
        <span className="num font-medium">{scalePromptText(prompt)}</span>
        <span className="text-muted"> · {SCALE_PROMPT_NOTE}</span>
      </p>
      {prompt.detected ? (
        <Button size="sm" variant="primary" onClick={() => applyDetectedScale()}>
          Use it
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => openCalibrate()}>
        Calibrate…
      </Button>
      <IconButton label="Measure without scale" icon={X} onClick={() => dismissScalePrompt()} />
    </section>
  );
}
