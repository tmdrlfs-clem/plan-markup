import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { markupSchema, type ImageMarkup, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { ADD_IMAGE, IMAGE_FAILED, pickImageFile, pickedImage, type ImageDecoder } from "./image-tool";
import { ADD_DIMENSION, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const SHA = "a".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };
const cal: Calibration = { xFactor: factorForRatio(75), yFactor: factorForRatio(75), unit: "mm", precision: "0", source: "ratio", ratio: 75 };

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

// Upright page, 1 device px a point, an 800 × 600 canvas; screen y down.
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

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const added = () => markupsOf(editorStore.getState(), SHA);
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;
const toasts = () => toastStore.getState().visible.map((t) => `${t.title} ${t.description ?? ""}`);

/** A file whose first bytes are a PNG header declaring `w` × `h`. */
function pngFile(w: number, h: number, size = 100): File {
  const bytes = new Uint8Array(Math.max(size, 33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, w);
  new DataView(bytes.buffer).setUint32(20, h);
  return new File([bytes], "photo.png", { type: "image/png" });
}

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  measurePainter.paintStatic(recorder().ctx, view);
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Image (Story 5.8)", () => {
  it("a picked file arms Image; a click places it centred, upright, at its natural size, then Select has it", async () => {
    const decode = vi.fn<ImageDecoder>(async () => ({ src: PNG_1PX, width: 200, height: 100 }));
    expect(await pickImageFile(pngFile(200, 100), decode)).toBe(true);
    expect(decode).toHaveBeenCalledWith(expect.any(File), "png", 2048);
    expect(viewerStore.getState().tool).toBe("image");
    expect(measurePainter.place({ x: 300, y: 300 }, AT)).toBe("done");
    const m = added()[0] as ImageMarkup;
    // 200 × 100 px at 0.75 pt a px: 150 × 75, its top left corner first (screen y down: user y up).
    expect(m).toMatchObject({ type: "image", src: PNG_1PX, points: [{ x: 225, y: 337.5 }, { x: 375, y: 337.5 }, { x: 375, y: 262.5 }, { x: 225, y: 262.5 }] });
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(undoLabel()).toBe(ADD_IMAGE);
    expect(viewerStore.getState().tool).toBe("select");
    expect(editorStore.getState().selection.ids).toEqual([m.id]);
    expect(pickedImage()).toBeNull();
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Image"]);
  });

  it("fits a large image in 40 % of the view (D1)", async () => {
    await pickImageFile(pngFile(4000, 1000), async () => ({ src: PNG_1PX, width: 2048, height: 512 }));
    measurePainter.place({ x: 400, y: 300 }, AT);
    const [p0, p1, , p3] = added()[0].points;
    // 2048 px is 1536 pt; the view is 800 wide: 320 pt.
    expect(p1.x - p0.x).toBeCloseTo(320);
    expect(p0.y - p3.y).toBeCloseTo(80);
  });

  it("refuses an SVG, a file declaring too many pixels and one that fails to decode, saying why; arms nothing", async () => {
    const decode = vi.fn<ImageDecoder>(async () => {
      throw new Error("bad");
    });
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "a.svg", { type: "image/svg+xml" });
    expect(await pickImageFile(svg, decode)).toBe(false);
    expect(await pickImageFile(pngFile(20_000, 20_000), decode)).toBe(false);
    expect(decode).not.toHaveBeenCalled();
    expect(await pickImageFile(pngFile(10, 10), decode)).toBe(false);
    expect(toasts()).toEqual(expect.arrayContaining([expect.stringMatching(/Only PNG and JPEG/), expect.stringMatching(/too many pixels/), expect.stringMatching(/could not be read/)]));
    expect(toasts().every((t) => t.startsWith(IMAGE_FAILED))).toBe(true);
    expect(viewerStore.getState().tool).toBe("select");
  });

  it("another tool drops the picked image; a click without one places nothing", async () => {
    await pickImageFile(pngFile(10, 10), async () => ({ src: PNG_1PX, width: 10, height: 10 }));
    setTool("pen");
    expect(pickedImage()).toBeNull();
    setTool("image");
    expect(measurePainter.place({ x: 1, y: 1 }, AT)).toBe("ignored");
    expect(added()).toHaveLength(0);
  });

  it("paints its box crossed out until it is decoded", () => {
    const m: Markup = { id: "0190a0f0-0000-7000-8000-000000000009", pageId: pageIdOf(SHA, 0), createdAt: "", style: { color: "#ff0000", width: 1, fontSize: 10 }, type: "image", points: [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }], src: PNG_1PX };
    editorStore.setState((s) => ({ doc: { ...s.doc, markups: { ...s.doc.markups, [SHA]: [m] } } }));
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    expect(r.ops.filter((o) => o.op === "lineTo")).toHaveLength(5);
    expect(r.ops.some((o) => o.op === "drawImage")).toBe(false);
  });

  it("the schema refuses a src that is not a PNG or JPEG data URL", () => {
    const base = { id: "0190a0f0-0000-7000-8000-000000000009", pageId: "p", createdAt: "", style: { color: "#ff0000", width: 1, fontSize: 10 }, type: "image", points: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }] };
    expect(markupSchema.safeParse({ ...base, src: PNG_1PX }).success).toBe(true);
    for (const src of ["data:image/svg+xml;base64,PHN2Zy8+", "https://example.com/a.png", "javascript:alert(1)", `${PNG_1PX}"`]) {
      expect(markupSchema.safeParse({ ...base, src }).success).toBe(false);
    }
  });
});

describe("Dimension (Story 5.8)", () => {
  function dimension() {
    setTool("dimension");
    expect(measurePainter.place({ x: 100, y: 100 }, AT)).toBe("continue");
    expect(measurePainter.place({ x: 200, y: 100 }, AT)).toBe("continue");
    return measurePainter.place({ x: 150, y: 130 }, AT);
  }

  it("two measured points then its line's: one undo step, the tool stays armed", () => {
    expect(dimension()).toBe("done");
    expect(added()[0]).toMatchObject({ type: "dimension", points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 130 }] });
    expect(undoLabel()).toBe(ADD_DIMENSION);
    expect(viewerStore.getState().tool).toBe("dimension");
  });

  it("shows Scale not set uncalibrated (in the warning colour) and the calibrated length otherwise", () => {
    dimension();
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["Dimension: Scale not set"]);
    expect(r.texts()).toEqual(["Scale not set"]);
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    // 100 pt at 1:75: 2646 mm.
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Dimension: 2646 mm"]);
  });

  it("previews its line, then the dimension to the pointer, with the live length", () => {
    setTool("dimension");
    measurePainter.place({ x: 100, y: 100 }, AT);
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 200, y: 100 })).toBe("Scale not set");
    measurePainter.place({ x: 200, y: 100 }, AT);
    const r = recorder();
    expect(measurePainter.paintActive(r.ctx, view, { x: 150, y: 140 })).toBe("Scale not set");
    expect(r.texts()).toContain("Scale not set");
  });
});
