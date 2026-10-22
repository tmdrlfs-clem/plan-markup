import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  applyMatrix,
  clampView,
  fitPageView,
  fitWidthView,
  invertMatrix,
  multiplyMatrix,
  normalizeRotation,
  panBy,
  pageToScreen,
  pageToScreenMatrix,
  pdfToPageMatrix,
  rotateView,
  rotatedSize,
  screenToPage,
  stepZoom,
  visibleBounds,
  zoomAt,
  zoomPercent,
  zoomToRect,
  type Rotation,
  type ViewState,
} from "./view";

const VP = { width: 1000, height: 600 };
const LANDSCAPE = { width: 2000, height: 1000 };
const PORTRAIT = { width: 600, height: 1200 };
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("matrices", () => {
  it("maps the centre to the viewport centre and scales by zoom", () => {
    const view: ViewState = { zoom: 2, centerX: 100, centerY: 50, rotation: 0 };
    close(pageToScreen(view, VP, { x: 100, y: 50 }), { x: 500, y: 300 });
    close(pageToScreen(view, VP, { x: 110, y: 50 }), { x: 520, y: 300 });
  });

  it("rotates clockwise: page right becomes screen down at 90°", () => {
    const view: ViewState = { zoom: 1, centerX: 0, centerY: 0, rotation: 90 };
    close(pageToScreen(view, VP, { x: 10, y: 0 }), { x: 500, y: 310 });
    close(pageToScreen(view, VP, { x: 0, y: 10 }), { x: 490, y: 300 });
  });

  it("screenToPage inverts pageToScreen for every rotation", () => {
    for (const rotation of ROTATIONS) {
      const view: ViewState = { zoom: 1.7, centerX: 321, centerY: -45, rotation };
      const p = { x: 77, y: 912 };
      close(screenToPage(view, VP, pageToScreen(view, VP, p)), p);
    }
  });

  it("inverts and multiplies matrices", () => {
    const m = pageToScreenMatrix({ zoom: 3, centerX: 5, centerY: 7, rotation: 270 }, VP);
    const id = multiplyMatrix(m, invertMatrix(m));
    [1, 0, 0, 1, 0, 0].forEach((v, i) => expect(id[i]).toBeCloseTo(v, 9));
  });

  it("pdfToPageMatrix matches pdf.js page space: origin top-left, /Rotate applied", () => {
    // Unrotated 100 x 50 pt page: PDF (0, 50) is the top-left corner.
    close(applyMatrix(pdfToPageMatrix({ width: 100, height: 50, rotate: 0 }), { x: 0, y: 50 }), { x: 0, y: 0 });
    close(applyMatrix(pdfToPageMatrix({ width: 100, height: 50, rotate: 0 }), { x: 100, y: 0 }), { x: 100, y: 50 });
    // /Rotate 90: page space is 50 x 100 (rotated dims); PDF origin (bottom-left) lands top-left.
    const r90 = pdfToPageMatrix({ width: 50, height: 100, rotate: 90 });
    close(applyMatrix(r90, { x: 0, y: 0 }), { x: 0, y: 0 });
    close(applyMatrix(r90, { x: 100, y: 50 }), { x: 50, y: 100 });
    // A view box with an offset origin.
    close(applyMatrix(pdfToPageMatrix({ width: 100, height: 50, rotate: 0 }, [10, 20, 110, 70]), { x: 10, y: 70 }), { x: 0, y: 0 });
    // /Rotate 180 and 270.
    close(applyMatrix(pdfToPageMatrix({ width: 100, height: 50, rotate: 180 }), { x: 100, y: 0 }), { x: 0, y: 0 });
    close(applyMatrix(pdfToPageMatrix({ width: 50, height: 100, rotate: 270 }), { x: 100, y: 50 }), { x: 0, y: 0 });
  });
});

describe("zoomAt", () => {
  it("keeps the page point under the cursor fixed, for every rotation", () => {
    for (const rotation of ROTATIONS) {
      const view: ViewState = { zoom: 0.8, centerX: 400, centerY: 300, rotation };
      const cursor = { x: 130, y: 470 };
      const before = screenToPage(view, VP, cursor);
      const next = zoomAt(view, VP, cursor, 2.5);
      expect(next.zoom).toBeCloseTo(2, 9);
      close(screenToPage(next, VP, cursor), before);
    }
  });

  it("clamps to 1 %–6400 % and still keeps the point fixed", () => {
    const view: ViewState = { zoom: 50, centerX: 0, centerY: 0, rotation: 0 };
    const cursor = { x: 900, y: 100 };
    const next = zoomAt(view, VP, cursor, 10);
    expect(next.zoom).toBe(MAX_ZOOM);
    close(screenToPage(next, VP, cursor), screenToPage(view, VP, cursor));
    expect(zoomAt(view, VP, cursor, 1e-9).zoom).toBe(MIN_ZOOM);
  });

  it("step zoom is √2 and clamps", () => {
    expect(ZOOM_STEP).toBeCloseTo(1.41421356, 6);
    expect(stepZoom(1, 1)).toBeCloseTo(Math.SQRT2, 12);
    expect(stepZoom(stepZoom(1, 1), 1)).toBeCloseTo(2, 12);
    expect(stepZoom(1, -1)).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("zoomPercent is relative to actual size at 72 dpi (1 pt = 1 CSS px = 100 %)", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.6413)).toBe(64);
    expect(zoomPercent(0.01)).toBe(1);
    expect(zoomPercent(64)).toBe(6400);
  });
});

describe("pan and rotate", () => {
  it("panBy moves the content with the drag on screen, for every rotation", () => {
    for (const rotation of ROTATIONS) {
      const view: ViewState = { zoom: 2, centerX: 100, centerY: 100, rotation };
      const p = { x: 120, y: 90 };
      const before = pageToScreen(view, VP, p);
      const after = pageToScreen(panBy(view, 30, -12), VP, p);
      close(after, { x: before.x + 30, y: before.y - 12 });
    }
  });

  it("rotateView turns about the viewport centre and normalises", () => {
    const view: ViewState = { zoom: 1, centerX: 10, centerY: 20, rotation: 270 };
    expect(rotateView(view, 90)).toEqual({ ...view, rotation: 0 });
    expect(rotateView(view, -90).rotation).toBe(180);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });

  it("rotatedSize swaps the sides at 90° and 270°", () => {
    expect(rotatedSize(LANDSCAPE, 0)).toEqual(LANDSCAPE);
    expect(rotatedSize(LANDSCAPE, 90)).toEqual({ width: 1000, height: 2000 });
    expect(rotatedSize(LANDSCAPE, 180)).toEqual(LANDSCAPE);
    expect(rotatedSize(LANDSCAPE, 270)).toEqual({ width: 1000, height: 2000 });
  });
});

describe("fit", () => {
  it("fit page centres the whole page with the margin (portrait, landscape, rotated)", () => {
    const landscape = fitPageView(LANDSCAPE, VP, 0, 10);
    expect(landscape).toEqual({ zoom: 0.49, centerX: 1000, centerY: 500, rotation: 0 }); // (1000 - 20) / 2000
    const portrait = fitPageView(PORTRAIT, VP, 0, 10);
    expect(portrait.zoom).toBeCloseTo(580 / 1200, 12);
    const rotated = fitPageView(PORTRAIT, VP, 90, 10); // on screen 1200 x 600
    expect(rotated.zoom).toBeCloseTo(980 / 1200, 12);
    for (const v of [landscape, portrait, rotated]) {
      const b = visibleBounds(v, VP);
      const page = v === landscape ? LANDSCAPE : PORTRAIT;
      expect(b.x).toBeLessThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(0);
      expect(b.x + b.width).toBeGreaterThanOrEqual(page.width);
      expect(b.y + b.height).toBeGreaterThanOrEqual(page.height);
    }
  });

  it("fit width fills the width; a tall page starts at its top edge", () => {
    const v = fitWidthView(PORTRAIT, VP, 0, 10);
    expect(v.zoom).toBeCloseTo(980 / 600, 12);
    close(pageToScreen(v, VP, { x: 0, y: 0 }), { x: 10, y: 10 });
    close(pageToScreen(v, VP, { x: 600, y: 0 }), { x: 990, y: 10 });
    // Rotated 90°: the page's left edge (x = 0) is the top on screen.
    const r = fitWidthView(PORTRAIT, VP, 90, 10);
    expect(r.zoom).toBeCloseTo(980 / 1200, 12);
    // Short enough to fit vertically: centred.
    const wide = fitWidthView(LANDSCAPE, VP, 0, 10);
    expect(wide.centerY).toBe(500);
  });
});

describe("clampView", () => {
  it("keeps at least 10 % of the page on screen", () => {
    const fit = fitPageView(LANDSCAPE, VP, 0, 0);
    const far = panBy(fit, 5000, 5000);
    const clamped = clampView(far, LANDSCAPE, VP);
    const tl = pageToScreen(clamped, VP, { x: 0, y: 0 });
    // Page is 1000 x 500 on screen: 10 % = 100 x 50 must stay inside.
    expect(tl.x).toBeCloseTo(1000 - 100, 6);
    expect(tl.y).toBeCloseTo(600 - 50, 6);
    const away = clampView(panBy(fit, -5000, -5000), LANDSCAPE, VP);
    const br = pageToScreen(away, VP, { x: 2000, y: 1000 });
    expect(br.x).toBeCloseTo(100, 6);
    expect(br.y).toBeCloseTo(50, 6);
  });

  it("leaves a view that already shows enough untouched, clamps zoom", () => {
    const fit = fitPageView(LANDSCAPE, VP, 90, 0);
    expect(clampView(fit, LANDSCAPE, VP)).toEqual(fit);
    expect(clampView({ ...fit, zoom: 1000 }, LANDSCAPE, VP).zoom).toBe(MAX_ZOOM);
  });

  it("zoomed far in, a viewport-sized share is enough", () => {
    const view: ViewState = { zoom: 64, centerX: 1000, centerY: 500, rotation: 0 };
    const out = clampView(panBy(view, 1e7, 0), LANDSCAPE, VP);
    const tl = pageToScreen(out, VP, { x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(0, 6); // the page's left edge at the viewport's left edge
  });
});

describe("zoomToRect and visibleBounds", () => {
  it("zooms the dragged screen rectangle to fill the viewport", () => {
    const view: ViewState = { zoom: 1, centerX: 500, centerY: 300, rotation: 0 };
    const next = zoomToRect(view, VP, { x: 100, y: 100, width: 200, height: 60 });
    expect(next.zoom).toBeCloseTo(5, 12); // min(1000/200, 600/60)
    close({ x: next.centerX, y: next.centerY }, { x: 200, y: 130 });
  });

  it("visibleBounds is the page-space box of the viewport (rotation-aware)", () => {
    expect(visibleBounds({ zoom: 2, centerX: 100, centerY: 100, rotation: 0 }, VP)).toEqual({ x: -150, y: -50, width: 500, height: 300 });
    const r = visibleBounds({ zoom: 2, centerX: 100, centerY: 100, rotation: 90 }, VP);
    expect(r.width).toBeCloseTo(300, 9);
    expect(r.height).toBeCloseTo(500, 9);
  });
});
