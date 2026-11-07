import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pageIdOf } from "@/core/calibration/calibration";
import type { RevisionMarkup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { installMeasureTools, measurePainter, paintMarkupsPreview } from "./measure-tool";
import { ADD_REVISION, setRevisionAuthor } from "./revision-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const SHA = "d".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };

/** A context that records calls, and each text drawn with its font. */
function recorder() {
  const texts: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props ? props[prop] : prop === "measureText" ? (text: string) => ({ width: text.length * 5 }) : (...args: unknown[]) => void (prop === "fillText" && texts.push(`${String(args[0])} @ ${String(props.font)}`)),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: 600 - p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 800,
  height: 600,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

const added = () => markupsOf(editorStore.getState(), SHA) as RevisionMarkup[];

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  measurePainter.paintStatic(recorder().ctx, view);
  setRevisionAuthor("Kim Lee");
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Revision stamp tool (Story 7.7)", () => {
  it("a click places a stamp (the next revision, today, the author), one undo step; then Select has it", () => {
    setTool("revision");
    expect(measurePainter.place({ x: 300, y: 200 }, AT)).toBe("done");
    const [a] = added();
    expect(a).toMatchObject({ type: "revision", pageId: pageIdOf(SHA, 0), revision: { rev: "A", description: "As-built", author: "Kim Lee" } });
    expect(a.revision.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(viewerStore.getState().tool).toBe("select");
    expect(editorStore.getState().selection.ids).toEqual([a.id]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_REVISION);

    setTool("revision");
    measurePainter.place({ x: 300, y: 400 }, AT);
    expect(added().map((m) => m.revision.rev)).toEqual(["A", "B"]);
  });

  it("paints its box, the revision (bold) and date in the header, then description and author", () => {
    setTool("revision");
    measurePainter.place({ x: 300, y: 200 }, AT);
    const { ctx, texts } = recorder();
    paintMarkupsPreview(ctx, added(), view, null);
    expect(texts[0]).toBe("Rev A @ bold 10px sans-serif");
    expect(texts[1]).toMatch(/^\d{4}-\d{2}-\d{2} @ 10px sans-serif$/);
    expect(texts.slice(2).map((t) => t.split(" @ ")[0])).toEqual(["As-built", "Kim Lee"]);
  });
});
