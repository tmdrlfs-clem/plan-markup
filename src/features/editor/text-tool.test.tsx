// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type TextMarkup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { TEXT_FIELD_LABEL, TextEditor } from "./text-editor";
import { ADD_CALLOUT, ADD_CLOUD_PLUS, ADD_NOTE, ADD_TEXT, ADD_TYPEWRITER, endTextEdit, finalizeText, setTypedText, textFrameStore, textLabel } from "./text-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const SHA = "a".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };

type Op = { op: string; args: unknown[] };
function recorder() {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props ? props[prop] : prop === "measureText" ? (text: string) => ({ width: text.length * 5 }) : (...args: unknown[]) => void ops.push({ op: prop, args }),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, texts: () => ops.filter((o) => o.op === "fillText").map((o) => o.args[0]) };
}

// Upright page, 1 device px a point; screen y down.
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

const added = () => markupsOf(editorStore.getState(), SHA) as TextMarkup[];
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;
const editing = () => editorStore.getState().tools.textEdit;
const type = (text: string) => {
  setTypedText(text);
  return endTextEdit(true);
};

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  // The page as shown: the text reads upright on it.
  measurePainter.paintStatic(recorder().ctx, view);
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("placing and typing (Story 5.6)", () => {
  it("Text box: two corners open the field; the typed text is added as one step, its box from the screen's top left", () => {
    setTool("text");
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.place({ x: 100, y: 50 }, AT)).toBe("done");
    expect(editing()?.draft.type).toBe("text");
    expect(added()).toHaveLength(0);
    expect(type("Hello there")).toBe(true);
    expect(added()[0]).toMatchObject({ type: "text", text: "Hello there", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }, { x: 0, y: 0 }] });
    expect(undoLabel()).toBe(ADD_TEXT);
    expect(viewerStore.getState().tool).toBe("text");
  });

  it("Text box (cloud border): a text box whose border is a cloud", () => {
    setTool("textcloud");
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.place({ x: 100, y: 50 }, AT)).toBe("done");
    expect(type("Clouded")).toBe(true);
    expect(added()[0]).toMatchObject({ type: "text", text: "Clouded", style: { cloud: true } });
    expect(undoLabel()).toBe(ADD_TEXT);
  });

  it("adds nothing for an empty or blank text (D2)", () => {
    setTool("note");
    measurePainter.place({ x: 10, y: 10 }, AT);
    expect(type("   \n ")).toBe(false);
    expect(added()).toHaveLength(0);
    expect(editing()).toBeNull();
  });

  it("Typewriter and Note: one click; Callout: tip then text; Cloud+: cloud, then text", () => {
    setTool("typewriter");
    expect(measurePainter.place({ x: 10, y: 400 }, AT)).toBe("done");
    type("Typed");
    expect(undoLabel()).toBe(ADD_TYPEWRITER);
    setTool("note");
    measurePainter.place({ x: 10, y: 300 }, AT);
    type("A note");
    expect(undoLabel()).toBe(ADD_NOTE);
    expect(added()[1]).toMatchObject({ type: "note", points: [{ x: 10, y: 300 }], text: "A note" });
    setTool("callout");
    measurePainter.place({ x: 300, y: 300 }, AT);
    measurePainter.place({ x: 100, y: 200 }, AT);
    type("See here");
    expect(undoLabel()).toBe(ADD_CALLOUT);
    const callout = added()[2];
    expect(callout.type).toBe("callout");
    expect(callout.points[0]).toEqual({ x: 100, y: 200 });
    expect(callout.points[4]).toEqual({ x: 300, y: 300 });
    setTool("cloudplus");
    for (const p of [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }]) measurePainter.place(p, { ...AT, tolerance: 1 });
    // Closed on its first corner, the cloud waits for the text's click.
    expect(measurePainter.place({ x: 200, y: 0 }, { ...AT, tolerance: 1 })).toBe("continue");
    expect(measurePainter.tracking).toBe(true);
    expect(measurePainter.place({ x: 0, y: 100 }, AT)).toBe("done");
    type("Revised");
    expect(undoLabel()).toBe(ADD_CLOUD_PLUS);
    expect(added()[3].points.slice(0, 3)).toEqual([{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }]);
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Typewriter: Typed", "Note: A note", "Callout: See here", "Cloud+: Revised"]);
  });

  it("Cloud+: Backspace while waiting for the text's click goes back to the cloud", () => {
    setTool("cloudplus");
    for (const p of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]) measurePainter.place(p, AT);
    expect(measurePainter.finish()).toBe("done");
    expect(editorStore.getState().tools.drawing?.ring).toHaveLength(3);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(editorStore.getState().tools.drawing).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(editorStore.getState().tools.drawing?.ring).toBeUndefined();
  });

  it("a click on the canvas while typing only ends the typing; another tool ends it too", () => {
    setTool("typewriter");
    measurePainter.place({ x: 10, y: 400 }, AT);
    setTypedText("First");
    expect(measurePainter.place({ x: 50, y: 50 }, AT)).toBe("ignored");
    expect(added()).toHaveLength(1);
    expect(editing()).toBeNull();
    measurePainter.place({ x: 50, y: 50 }, AT);
    setTypedText("Second");
    setTool("select");
    expect(added().map((m) => m.text)).toEqual(["First", "Second"]);
  });

  it("paints the field's frame while typing (CSS px), and none off the page", () => {
    setTool("text");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 100, y: 50 }, AT);
    measurePainter.paintActive(recorder().ctx, view, null);
    expect(textFrameStore.getState().frame).toMatchObject({ x: 0, y: 450, width: 100, height: 50, angle: 0, fontPx: 10, padPx: 3, kind: "text" });
    measurePainter.paintActive(recorder().ctx, { ...view, pageIndex: 1 }, null);
    expect(textFrameStore.getState().frame).toBeNull();
    endTextEdit(false);
  });
});

describe("rendering text markups", () => {
  it("wraps a text box's text in its box, plain text, and draws its border", () => {
    setTool("text");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 40, y: 50 }, AT);
    type("<b>one</b> two");
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    // 5 px a character, 34 px inside the padding: "<b>one</b>" is 50 wide, broken between characters.
    expect(r.texts().join("|")).toBe("<b>one|</b>|two");
    expect(r.ops.some((o) => o.op === "stroke")).toBe(true);
  });

  it("labels the list with the text's start on one line", () => {
    const m = { id: "x", pageId: "p", createdAt: "", style: DEFAULT_MARKUP_STYLE, type: "note", points: [{ x: 0, y: 0 }], text: `a\nb ${"c".repeat(60)}` } as TextMarkup;
    expect(textLabel(m)).toBe(`Note: a b ${"c".repeat(35)}…`);
  });
});

describe("finalizeText (D3)", () => {
  const measure = (s: string, size: number) => s.length * size * 0.5;
  const box = [
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 90 },
    { x: 0, y: 90 },
  ];
  const draft = (type: "text" | "typewriter"): TextMarkup => ({ id: "x", pageId: "p", createdAt: "", style: DEFAULT_MARKUP_STYLE, type, points: box as never, text: "" });

  it("grows a box down to its wrapped lines", () => {
    // 10 pt: 5 a character, 94 wide inside: "aaaaaaaaaa bbbbbbbbbb" wraps to two lines, 2 × 11.5 + 6 tall.
    const m = finalizeText(draft("text"), "aaaaaaaaaa bbbbbbbbbb", 1, measure);
    expect(m.points[3]!.y).toBeCloseTo(100 - 29);
  });

  it("sizes a typewriter's box to its lines", () => {
    const m = finalizeText(draft("typewriter"), "abcd\nab", 1, measure);
    expect(m.points[1]!.x).toBeCloseTo(20);
    expect(m.points[3]!.y).toBeCloseTo(100 - 23);
  });
});

describe("TextEditor", () => {
  function start() {
    setTool("typewriter");
    measurePainter.place({ x: 10, y: 400 }, AT);
    act(() => void measurePainter.paintActive(recorder().ctx, view, null));
  }

  it("opens a focused field over the canvas; letters typed in it arm no tool; Esc adds the text", async () => {
    render(<TextEditor />);
    act(start);
    const field = screen.getByRole("textbox", { name: TEXT_FIELD_LABEL });
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.change(field, { target: { value: "rect" } });
    fireEvent.keyDown(field, { key: "r", code: "KeyR" });
    expect(viewerStore.getState().tool).toBe("typewriter");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(added()[0]).toMatchObject({ type: "typewriter", text: "rect" });
    expect(screen.queryByRole("textbox", { name: TEXT_FIELD_LABEL })).toBeNull();
  });

  it("Ctrl+Enter and leaving the field add the text; Enter is a new line", async () => {
    render(<TextEditor />);
    act(start);
    let field = screen.getByRole("textbox", { name: TEXT_FIELD_LABEL });
    fireEvent.change(field, { target: { value: "one\ntwo" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(added()).toHaveLength(0);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(added()[0].text).toBe("one\ntwo");
    act(start);
    field = screen.getByRole("textbox", { name: TEXT_FIELD_LABEL });
    expect(field).toHaveValue("");
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.change(field, { target: { value: "blurred" } });
    act(() => field.blur());
    expect(added()[1].text).toBe("blurred");
  });
});
