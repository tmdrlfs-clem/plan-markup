// Scripted pan / zoom gestures for the render spike measurement (Story 2.3;
// throwaway). They drive the same engine methods as the mouse handlers, one
// step per animation frame, while the engine records frame deltas.
import type { SpikeEngine, SpikeStats } from "./engine";

function frames(engine: SpikeEngine, durationMs: number, step: (t: number, dt: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let start = 0;
    let last = 0;
    engine.tick = (now) => {
      if (!start) {
        start = now;
        last = now;
      }
      const t = Math.min(1, (now - start) / durationMs);
      step(t, now - last);
      last = now;
      if (t >= 1) {
        engine.tick = null;
        resolve();
      }
    };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Zooms to 2x fit around the page centre and waits for its tiles (setup for the pan run). */
export async function prepareForPan(engine: SpikeEngine): Promise<void> {
  const fit = engine.fitView();
  engine.setView(fit);
  const vp = engine.viewportSize;
  engine.zoomAt(2, vp.width / 2, vp.height / 2);
  await engine.waitTilesIdle();
}

/**
 * 5 s continuous pan along a Lissajous path (peak ~1,200 CSS px/s), recorded.
 * No settle happens mid-gesture, so exposed areas show scaled/preview content.
 */
export async function runPan(engine: SpikeEngine, durationMs = 5000): Promise<SpikeStats> {
  const vp = engine.viewportSize;
  const ax = vp.width * 0.45;
  const ay = vp.height * 0.4;
  let px = 0;
  let py = 0;
  engine.startRecording();
  await frames(engine, durationMs, (t) => {
    const x = ax * Math.sin(2 * Math.PI * t * 2);
    const y = ay * Math.sin(2 * Math.PI * t * 3);
    engine.panBy(x - px, y - py);
    px = x;
    py = y;
  });
  await sleep(200);
  return engine.stopRecording();
}

/**
 * From fit: three 2x zoom-ins around an off-centre point (buckets 0 -> 1 -> 2 -> 3),
 * each animated over 400 ms then held 400 ms (tiles requested after the 150 ms
 * settle), then three 0.5x zoom-outs back to fit. Recorded.
 */
export async function runZoom(engine: SpikeEngine): Promise<SpikeStats> {
  engine.setView(engine.fitView());
  await engine.waitTilesIdle();
  const vp = engine.viewportSize;
  const cx = vp.width * 0.42;
  const cy = vp.height * 0.46;
  engine.startRecording();
  for (const factor of [2, 2, 2, 0.5, 0.5, 0.5]) {
    let applied = 0;
    await frames(engine, 400, (t) => {
      const target = Math.log(factor) * t;
      engine.zoomAt(Math.exp(target - applied), cx, cy);
      applied = target;
    });
    await sleep(400);
  }
  await sleep(200);
  return engine.stopRecording();
}
