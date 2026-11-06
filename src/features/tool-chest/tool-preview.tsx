"use client";

// Story 7.2 (UX-DR19): a tool tile's preview, its markups fitted into a small
// canvas on the sheet's white. An image comes by its signed URL through
// fetch (the CSP allows the storage origin for connect, not for img) and is
// drawn from a data URL, as image markups are.

import { useEffect, useRef, useState } from "react";

import { markupBounds, type Point } from "@/core/markup/geometry";
import { toolMarkups, type ToolContent } from "@/core/tools/tool";
import { decodeMarkupImage, loadMarkupFonts, paintMarkupsPreview } from "@/features/editor";
import type { LayerView } from "@/features/viewer";

/** Image data URLs by signed URL's path (a signed URL changes; its object does not). */
const images = new Map<string, Promise<string | null>>();
const loaded = new Map<string, string>();

function keyOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The tool image at `url` as a data URL (null when it cannot be read). */
export function toolImageDataUrl(url: string): Promise<string | null> {
  const key = keyOf(url);
  let pending = images.get(key);
  if (!pending) {
    pending = fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then(
        (blob) =>
          blob &&
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => null);
    images.set(key, pending);
    void pending.then((v) => {
      if (v === null) images.delete(key);
      else loaded.set(key, v);
    });
  }
  return pending;
}

/** Story 7.3: the tool image at `url` if it has been read already (a drag starts synchronously). */
export function cachedToolImage(url: string): string | null {
  return loaded.get(keyOf(url)) ?? null;
}

const PREVIEW_COLORS = { halo: "#ffffff", warning: "#b45309", selection: "#2563eb", fontFamily: "sans-serif" };

/** A LayerView that fits `content`'s markups (y up) into a `size` px square at `dpr`. */
export function previewView(markups: Parameters<typeof markupBounds>[0][], size: number, dpr: number): LayerView {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of markups) {
    const b = markupBounds(m);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  const device = size * dpr;
  const pad = 4 * dpr;
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const k = Number.isFinite(w) ? Math.min((device - 2 * pad) / w, (device - 2 * pad) / h) : 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    documentId: "tool",
    pageIndex: 0,
    userUnit: 1,
    toDevice: (p: Point) => ({ x: device / 2 + (p.x - cx) * k, y: device / 2 - (p.y - cy) * k }),
    devicePerPt: k,
    dpr,
    width: device,
    height: device,
    colors: PREVIEW_COLORS,
  };
}

/** `imageUrl` is the asset's signed URL; `imageData`, an image's data URL not yet uploaded (the Add dialog). */
export function ToolPreview({ content, imageUrl, imageData = null, size = 48 }: { content: ToolContent | null; imageUrl: string | null; imageData?: string | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fetched, setFetched] = useState<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const wanted = imageData ?? fetched;
  // Painted once decoded (the painters draw decoded images only).
  const src = wanted !== null && ready === wanted ? wanted : null;

  useEffect(() => {
    if (wanted === null) return;
    let live = true;
    void decodeMarkupImage(wanted).then(() => {
      if (live) setReady(wanted);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  // Story 7.5: painted again once the faces its text asks for have loaded.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    if (!content?.markups.some((m) => m.style.font)) return;
    let live = true;
    void loadMarkupFonts(content.markups).then(() => {
      if (live) setFonts((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [content]);

  useEffect(() => {
    if (!imageUrl) return;
    let live = true;
    void toolImageDataUrl(imageUrl).then((v) => {
      if (live) setFetched(v);
    });
    return () => {
      live = false;
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = ref.current;
    const c = canvas?.getContext("2d");
    if (!canvas || !c || !content) return;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    const markups = toolMarkups(content, src);
    if (markups.length === 0) return;
    paintMarkupsPreview(c, markups, previewView(markups, size, dpr), content.calibration);
  }, [content, src, size, fonts]);

  return <canvas ref={ref} aria-hidden="true" data-testid="tool-preview" className="rounded-[2px] border border-border" style={{ width: size, height: size }} />;
}
