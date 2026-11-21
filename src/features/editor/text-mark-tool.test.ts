import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MarkupIndex } from "@/core/markup/markup-index";
import type { PageText } from "@/core/markup/text-select";
import { markupSchema } from "@/core/schema/markup";
import { buildPageText, type TextItem } from "@/core/search/page-text";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { textPromptStore } from "./text-prompt";
import { attachmentStore } from "./attachment-tool";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { vertexIndices } from "./handles";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { ADD_STRIKETHROUGH, ADD_UNDERLINE } from "./text-mark-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const SHA = "a".repeat(64);

type Op = { op: string; args: unknown[] };
function recorder() {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) => (prop in props ? props[prop] : (...args: unknown[]) => void ops.push({ op: prop, args })),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: 500 - p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 0,
  height: 0,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

function item(str: string, x: number, y: number, eol = false): TextItem {
  const w = str.length * 6;
  return { str, x, y, width: w, fontSize: 10, quad: [x, y - 2, x + w, y - 2, x + w, y + 8, x, y + 8], eol };
}
const items = [item("ROOM 101 MEETING", 0, 100, true), item("CH +2700", 0, 80)];
const text: PageText = { items, index: buildPageText(items) };
const AT = { documentId: SHA, pageIndex: 0, view, text };

const added = () => markupsOf(editorStore.getState(), SHA);
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Underline and Strikethrough (Story 5.9)", () => {
  it("a drag from a word selects whole words; the release underlines them as one step; the tool stays armed", () => {
    setTool("underline");
    measurePainter.textMark!("start", { x: 3, y: 102 }, AT);
    measurePainter.textMark!("move", { x: 33, y: 102 }, AT);
    // Layer 3: the selection and its live text.
    const r = recorder();
    expect(measurePainter.paintActive(r.ctx, view, null)).toBe("ROOM 101");
    expect(r.ops.some((o) => o.op === "fill")).toBe(true);
    measurePainter.textMark!("end", { x: 33, y: 102 }, AT);
    const [m] = added();
    expect(m).toMatchObject({ type: "underline", text: "ROOM 101", points: [{ x: 0, y: 98 }, { x: 48, y: 98 }, { x: 48, y: 108 }, { x: 0, y: 108 }] });
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(undoLabel()).toBe(ADD_UNDERLINE);
    expect(viewerStore.getState().tool).toBe("underline");
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Underline: ROOM 101"]);
  });

  it("Strikethrough across two lines: one quad per item; hit inside them; no vertex handles", () => {
    setTool("strikethrough");
    measurePainter.textMark!("start", { x: 60, y: 101 }, AT);
    measurePainter.textMark!("end", { x: 5, y: 81 }, AT);
    const [m] = added();
    expect(m).toMatchObject({ type: "strikethrough", text: "MEETING CH" });
    expect(m.points).toHaveLength(8);
    expect(undoLabel()).toBe(ADD_STRIKETHROUGH);
    const index = new MarkupIndex([m]);
    expect(index.hit({ x: 70, y: 103 }, 0)?.id).toBe(m.id);
    expect(index.hit({ x: 30, y: 103 }, 0)).toBeNull();
    expect(vertexIndices(m)).toEqual([]);
  });

  it("Text highlight (yellow, 40 %, filled) and Squiggly underline (a zigzag) mark the words the same way", () => {
    setTool("texthighlight");
    measurePainter.textMark!("start", { x: 3, y: 102 }, AT);
    measurePainter.textMark!("end", { x: 33, y: 102 }, AT);
    setTool("squiggly");
    measurePainter.textMark!("start", { x: 3, y: 82 }, AT);
    measurePainter.textMark!("end", { x: 40, y: 82 }, AT);
    const [hl, sq] = added();
    expect(hl).toMatchObject({ type: "texthighlight", text: "ROOM 101", style: { color: "#ffff00", opacity: 0.4 } });
    expect(sq).toMatchObject({ type: "squiggly", text: "CH +2700" });
    expect(markupSchema.safeParse(hl).success && markupSchema.safeParse(sq).success).toBe(true);
    expect(undoLabel()).toBe("Add squiggly underline");
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["Text highlight: ROOM 101", "Squiggly: CH +2700"]);
    // The squiggle is a run of short segments, not one line.
    expect(r.ops.filter((o) => o.op === "lineTo").length).toBeGreaterThan(5);
  });

  it("Replace text: the drag asks for the replacement; Add strikes the words with it and a caret, Cancel adds nothing", () => {
    setTool("replacetext");
    measurePainter.textMark!("start", { x: 3, y: 102 }, AT);
    measurePainter.textMark!("end", { x: 33, y: 102 }, AT);
    const prompt = textPromptStore.getState().prompt!;
    expect(prompt.label).toBe("Replace “ROOM 101” with");
    expect(added()).toHaveLength(0);
    prompt.onSubmit("ROOM 102");
    const [m] = added();
    expect(m).toMatchObject({ type: "strikethrough", text: "ROOM 101", replacement: "ROOM 102" });
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(undoLabel()).toBe("Add replace text");
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Replace: ROOM 101 → ROOM 102"]);
    textPromptStore.setState({ prompt: null });
  });

  it("Select text: the drag copies the words to the clipboard and adds nothing", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void writes.push(t) }, configurable: true });
    setTool("selecttext");
    measurePainter.textMark!("start", { x: 3, y: 102 }, AT);
    measurePainter.textMark!("end", { x: 33, y: 102 }, AT);
    await Promise.resolve();
    expect(writes).toEqual(["ROOM 101"]);
    expect(added()).toHaveLength(0);
  });

  it("Insert text: a click asks for the text; Add places a caret there with it", () => {
    setTool("inserttext");
    expect(measurePainter.place({ x: 50, y: 90 }, { ...AT, tolerance: 1 })).toBe("done");
    textPromptStore.getState().prompt!.onSubmit("TYP.");
    const [m] = added();
    expect(m).toMatchObject({ type: "caret", points: [{ x: 50, y: 90 }], text: "TYP." });
    expect(undoLabel()).toBe("Add insert text");
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Insert: TYP."]);
    expect(new MarkupIndex([m]).hit({ x: 51, y: 87 }, 0)?.id).toBe(m.id);
    textPromptStore.setState({ prompt: null });
  });

  it("File attachment: a picked file's paperclip at the click, then Select has it", () => {
    attachmentStore.setState({ picked: { name: "spec.txt", mime: "text/plain", data: "aGk=" } });
    setTool("attachment");
    expect(measurePainter.place({ x: 40, y: 40 }, { ...AT, tolerance: 1 })).toBe("done");
    const [m] = added();
    expect(m).toMatchObject({ type: "attachment", name: "spec.txt", points: [{ x: 40, y: 40 }] });
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(undoLabel()).toBe("Add attachment");
    expect(viewerStore.getState().tool).toBe("select");
    expect(attachmentStore.getState().picked).toBeNull();
    expect(new MarkupIndex([m]).hit({ x: 44, y: 36 }, 0)?.id).toBe(m.id);
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["Attachment: spec.txt"]);
    expect(r.ops.some((o) => o.op === "stroke" || o.op === "strokeRect")).toBe(true);
  });

  it("Link: a box, then its address (made a web link); a bad address adds nothing", () => {
    setTool("link");
    measurePainter.place({ x: 10, y: 10 }, { ...AT, tolerance: 1 });
    expect(measurePainter.place({ x: 60, y: 40 }, { ...AT, tolerance: 1 })).toBe("done");
    textPromptStore.getState().prompt!.onSubmit("www.example.com/spec");
    const [m] = added();
    expect(m).toMatchObject({ type: "link", uri: "https://www.example.com/spec" });
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(undoLabel()).toBe("Add link");
    expect(new MarkupIndex([m]).hit({ x: 30, y: 25 }, 0)?.id).toBe(m.id);
    measurePainter.place({ x: 70, y: 10 }, { ...AT, tolerance: 1 });
    measurePainter.place({ x: 90, y: 40 }, { ...AT, tolerance: 1 });
    textPromptStore.getState().prompt!.onSubmit("javascript:alert(1)");
    expect(added()).toHaveLength(1);
    expect(markupSchema.safeParse({ ...m, uri: "javascript:alert(1)" }).success).toBe(false);
    textPromptStore.setState({ prompt: null });
  });

  it("a press away from text, or before the page's text is read, marks nothing; a cancel drops the drag", () => {
    setTool("underline");
    measurePainter.textMark!("start", { x: 300, y: 300 }, AT);
    measurePainter.textMark!("end", { x: 33, y: 102 }, AT);
    measurePainter.textMark!("start", { x: 3, y: 102 }, { ...AT, text: null });
    measurePainter.textMark!("end", { x: 33, y: 102 }, { ...AT, text: null });
    measurePainter.textMark!("start", { x: 3, y: 102 }, AT);
    measurePainter.textMark!("cancel", { x: 33, y: 102 }, AT);
    expect(added()).toHaveLength(0);
    expect(editorStore.getState().tools.drawing).toBeNull();
    // A click places nothing either.
    expect(measurePainter.place({ x: 3, y: 102 }, { documentId: SHA, pageIndex: 0, tolerance: 0 })).toBe("ignored");
  });
});
