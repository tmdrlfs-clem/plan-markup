"use client";

// Render-spike viewer shell (Story 2.3; throwaway). React only mounts the
// canvas stack and the toolbar; the engine owns everything per frame.
// URL options: ?fixture=l17|l21|a0 (dev fixture route) &tile=256|512|1024
// &pdfjs=inline|nested &budget=<MB> &markups=<n> &progressive=0|1. window.__spike is the
// measurement API used by scripts/spike-render/measure.mjs.
import { useEffect, useRef, useState } from "react";
import { SpikeEngine, type EngineOptions } from "./engine";
import { prepareForPan, runPan, runZoom } from "./scripted";

function optionsFromSearch(search: string): EngineOptions & { fixture: string | null } {
  const q = new URLSearchParams(search);
  const tile = Number(q.get("tile"));
  const budget = Number(q.get("budget"));
  const markups = q.has("markups") ? Number(q.get("markups")) : 500;
  return {
    fixture: q.get("fixture"),
    tileSize: [256, 512, 1024].includes(tile) ? tile : 512,
    pdfjsWorker: q.get("pdfjs") === "nested" ? "nested" : "inline",
    budgetBytes: (budget > 0 ? budget : 256) * 1024 * 1024,
    markupCount: Number.isInteger(markups) && markups >= 0 ? Math.min(markups, 20_000) : 500,
    progressive: q.get("progressive") !== "0",
  };
}

async function fetchFixture(name: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; fetchMs: number }> {
  const t0 = performance.now();
  const res = await fetch(`/spike/fixture/${encodeURIComponent(name)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fixture ${name}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, fetchMs: performance.now() - t0 };
}

type SpikeApi = {
  open(name: string): Promise<{ fetchMs: number; openMs: number; firstTileMs: number; firstPartialMs: number | null; bytes: number }>;
  waitIdle(timeoutMs?: number): Promise<boolean>;
  prepareForPan(): Promise<void>;
  pan(ms?: number): ReturnType<typeof runPan>;
  zoom(): ReturnType<typeof runZoom>;
  stats(): SpikeEngine["stats"];
  info(): { fit: number; view: SpikeEngine["view"]; cacheBytes: number; markups: number; options: EngineOptions; dpr: number };
};

declare global {
  interface Window {
    __spike?: SpikeApi;
  }
}

export function SpikeRenderViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLCanvasElement>(null);
  const markupsRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpikeEngine | null>(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !tilesRef.current || !markupsRef.current || !activeRef.current) return;
    const opts = optionsFromSearch(window.location.search);
    const engine = new SpikeEngine(tilesRef.current, markupsRef.current, activeRef.current, opts);
    engine.onStatus = setStatus;
    engineRef.current = engine;

    const openBytes = async (bytes: Uint8Array<ArrayBuffer>, fetchMs: number) => {
      const size = bytes.byteLength; // read before the buffer is transferred to the worker
      const r = await engine.open(bytes);
      setResult(`first tile ${r.firstTileMs.toFixed(0)} ms (open ${r.openMs.toFixed(0)} ms, fetch ${fetchMs.toFixed(0)} ms)`);
      return { ...r, fetchMs, bytes: size };
    };
    window.__spike = {
      async open(name) {
        const { bytes, fetchMs } = await fetchFixture(name);
        return openBytes(bytes, fetchMs);
      },
      waitIdle: (ms) => engine.waitTilesIdle(ms),
      prepareForPan: () => prepareForPan(engine),
      pan: (ms) => runPan(engine, ms),
      zoom: () => runZoom(engine),
      stats: () => engine.stats,
      info: () => ({
        fit: engine.fitScale,
        view: engine.view,
        cacheBytes: engine.cacheBytes,
        markups: engine.markupTotal,
        options: engine.options,
        dpr: window.devicePixelRatio,
      }),
    };
    (window as unknown as { __spikeOpenBytes?: typeof openBytes }).__spikeOpenBytes = openBytes;
    if (opts.fixture) void window.__spike.open(opts.fixture).catch((e: unknown) => setStatus(String(e)));

    // Input: drag pans, wheel pans, Ctrl+wheel zooms around the cursor.
    let drag: { x: number; y: number; id: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) {
        engine.panBy(e.clientX - drag.x, e.clientY - drag.y);
        drag = { ...drag, x: e.clientX, y: e.clientY };
      } else {
        const p = local(e);
        engine.hoverAt(p.x, p.y);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const p = local(e);
        engine.zoomAt(Math.exp(-e.deltaY * 0.002), p.x, p.y);
      } else {
        engine.panBy(-e.deltaX, -e.deltaY);
      }
    };
    const onResize = () => engine.resize();
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      delete window.__spike;
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const t0 = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const open = (window as unknown as { __spikeOpenBytes?: (b: Uint8Array<ArrayBuffer>, ms: number) => Promise<unknown> }).__spikeOpenBytes;
    await open?.(bytes, performance.now() - t0);
  };

  const canvasClass = "absolute inset-0 h-full w-full";
  return (
    <div className="fixed inset-0 flex flex-col bg-surface-0 text-text">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm">
        <strong>Render spike (dev only)</strong>
        <input type="file" accept="application/pdf" onChange={(e) => void onFile(e.target.files?.[0])} />
        <span data-testid="spike-status">{status}</span>
        <span>{result}</span>
      </div>
      <div ref={hostRef} className="relative flex-1 touch-none overflow-hidden select-none" data-testid="spike-host">
        <canvas ref={tilesRef} className={canvasClass} />
        <canvas ref={markupsRef} className={canvasClass} />
        <canvas ref={activeRef} className={canvasClass} />
      </div>
    </div>
  );
}
