// Render spike measurement (Story 2.3). Local only: needs the private fixtures,
// the reference machine and a server on --base with the spike gate open (next dev,
// or `next start` with PLAN_MARKUP_LOCAL_SPIKE=1). Always exits 0: it measures.
//
// For each fixture x DPR x run: fresh page at /spike/render, open the fixture
// (time from bytes available to the first tile painted), wait for tiles, then a
// scripted 5 s pan at 2x fit and a zoom sequence (fit -> 8x -> fit) with 500
// markups, collecting rAF frame deltas, long tasks (PerformanceObserver) and
// worker tile render times. Run 1 of each fixture/DPR also records a Chrome
// trace to fixtures/private/traces/<label>-<fixture>-dpr<d>.json and screenshots.
//
// Usage: node scripts/spike-render/measure.mjs [--base http://localhost:3020]
//   [--fixtures l17,l21,a0] [--runs 3] [--dpr 1,1.5] [--tile 512]
//   [--pdfjs inline|nested] [--progressive 1|0] [--label dev] [--no-trace] [--skip-gestures]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "fixtures/private/traces");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

const base = arg("--base", "http://localhost:3020");
const fixtures = arg("--fixtures", "l17,l21,a0").split(",");
const runs = Number(arg("--runs", "3"));
const dprs = arg("--dpr", "1,1.5").split(",").map(Number);
const tile = Number(arg("--tile", "512"));
const pdfjs = arg("--pdfjs", "inline");
const progressive = arg("--progressive", "1");
const label = arg("--label", "dev");
const trace = !flag("--no-trace");
const gestures = !flag("--skip-gestures");

const quantile = (xs, q) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
};
const median = (xs) => quantile(xs.filter((x) => x !== null && Number.isFinite(x)), 0.5);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

/** fps from rAF deltas: p50 from the median delta, p5 from the 95th percentile delta. */
function frameSummary(stats) {
  const d = stats.frameDeltas;
  const p50 = quantile(d, 0.5);
  const p95 = quantile(d, 0.95);
  return {
    frames: d.length,
    frameMsP50: r1(p50),
    frameMsP95: r1(p95),
    frameMsMax: r1(d.length ? Math.max(...d) : null),
    fpsP50: r1(p50 ? 1000 / p50 : null),
    fpsP5: r1(p95 ? 1000 / p95 : null),
    over33ms: d.filter((x) => x > 33.4).length,
    longTasks: stats.longTasks.length,
    longestTaskMs: r1(stats.longTasks.length ? Math.max(...stats.longTasks.map((t) => t.duration)) : 0),
    markupDrawMsP95: r1(quantile(stats.markupDrawMs, 0.95)),
    tilesDrawMsP95: r1(quantile(stats.tilesDrawMs, 0.95)),
    peakHeapMb: r1(stats.peakHeapBytes / 1048576),
    peakCacheMb: r1(stats.peakCacheBytes / 1048576),
  };
}

function tileSummary(tileRenders) {
  const byBucket = {};
  for (const t of tileRenders) {
    const k = t.preview ? (t.partial ? "previewPartial" : "preview") : String(t.bucket);
    (byBucket[k] ??= []).push(t.renderMs);
  }
  const out = {};
  for (const [k, xs] of Object.entries(byBucket)) {
    out[k] = { n: xs.length, p50: r1(quantile(xs, 0.5)), p95: r1(quantile(xs, 0.95)), max: r1(Math.max(...xs)) };
  }
  return out;
}

/** Main-thread and worker task durations > 50 ms from a Chrome trace. */
function traceSummary(file) {
  let events;
  try {
    const json = JSON.parse(readFileSync(file, "utf8"));
    events = Array.isArray(json) ? json : json.traceEvents;
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
  const names = new Map();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name ?? "");
  }
  const perThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    if (e.name !== "ThreadControllerImpl::RunTask" && e.name !== "RunTask") continue;
    const key = `${e.pid}:${e.tid}`;
    const name = names.get(key) ?? "";
    if (name !== "CrRendererMain" && !name.startsWith("DedicatedWorker")) continue;
    const t = perThread.get(key) ?? { name, pid: e.pid, total: 0, over50: [], max: 0 };
    const ms = e.dur / 1000;
    t.total += ms;
    t.max = Math.max(t.max, ms);
    if (ms > 50) t.over50.push(r1(ms));
    perThread.set(key, t);
  }
  // The page's renderer is the CrRendererMain with the most work.
  const mains = [...perThread.values()].filter((t) => t.name === "CrRendererMain").sort((a, b) => b.total - a.total);
  const main = mains[0];
  const workers = [...perThread.values()].filter((t) => t.name.startsWith("DedicatedWorker") && (!main || t.pid === main.pid));
  return {
    mainLongestTaskMs: r1(main?.max ?? null),
    mainTasksOver50ms: main?.over50.length ?? null,
    mainTasksOver50msList: (main?.over50 ?? []).sort((a, b) => b - a).slice(0, 10),
    workerLongestTaskMs: r1(workers.length ? Math.max(...workers.map((w) => w.max)) : null),
  };
}

async function one(browser, fixture, dpr, run) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  const url = `${base}/spike/render?tile=${tile}&pdfjs=${pdfjs}&progressive=${progressive}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__spike), null, { timeout: 120_000 });
  // Let dev compilation and the worker chunk settle before timing.
  await page.waitForTimeout(1500);
  const tag = `${label}-${fixture}-dpr${dpr}`;
  const tracePath = path.join(OUT, `${tag}.json`);
  const traceThis = trace && run === 1;
  if (traceThis) {
    await browser.startTracing(page, {
      path: tracePath,
      categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "v8.execute", "blink.user_timing"],
    });
  }
  const result = { fixture, dpr, run, label, tile, pdfjs, progressive };
  try {
    result.open = await page.evaluate((name) => window.__spike.open(name), fixture);
    result.tilesIdle = await page.evaluate(() => window.__spike.waitIdle(180_000));
    const openStats = await page.evaluate(() => window.__spike.stats());
    result.openLongTasks = openStats.longTasks.length;
    result.openLongestTaskMs = r1(openStats.longTasks.length ? Math.max(...openStats.longTasks.map((t) => t.duration)) : 0);
    result.openTiles = tileSummary(openStats.tileRenders);
    result.info = await page.evaluate(() => window.__spike.info());
    if (run === 1) await page.screenshot({ path: path.join(OUT, `${tag}-open.png`) });
    if (gestures) {
      await page.evaluate(() => window.__spike.prepareForPan());
      await page.bringToFront();
      const pan = await page.evaluate(() => window.__spike.pan(5000));
      result.panVisibility = await page.evaluate(() => document.visibilityState);
      result.pan = { ...frameSummary(pan), tiles: tileSummary(pan.tileRenders) };
      if (run === 1) await page.screenshot({ path: path.join(OUT, `${tag}-pan.png`) });
      await page.bringToFront();
      const zoom = await page.evaluate(() => window.__spike.zoom());
      result.zoomVisibility = await page.evaluate(() => document.visibilityState);
      result.zoom = { ...frameSummary(zoom), tiles: tileSummary(zoom.tileRenders) };
      await page.evaluate(() => window.__spike.waitIdle(180_000));
      if (run === 1) {
        // A zoomed-in view so the screenshot shows real tiles and markups at 4x.
        await page.evaluate(() => {
          const s = window.__spike;
          return s.prepareForPan();
        });
        await page.screenshot({ path: path.join(OUT, `${tag}-2x.png`) });
      }
    }
  } catch (e) {
    result.error = String(e?.message ?? e);
  }
  if (traceThis) {
    await browser.stopTracing();
    result.trace = { file: path.relative(ROOT, tracePath), ...traceSummary(tracePath) };
  }
  result.consoleErrors = errors.slice(0, 20);
  await context.close();
  return result;
}

/** True when a gesture ran at ~1 Hz with no long task (window throttling, not page cost). */
function throttled(r) {
  return [r.pan, r.zoom].some((g) => g && g.frameMsP50 > 500 && g.longTasks === 0);
}

function aggregate(results) {
  const groups = new Map();
  for (const r of results) {
    const k = `${r.fixture}|${r.dpr}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(r);
  }
  const rows = [];
  for (const [k, rs] of groups) {
    const [fixture, dpr] = k.split("|");
    const ok = rs.filter((r) => !r.error && !r.throttled);
    const longestMain = Math.max(
      ...ok.map((r) => Math.max(r.openLongestTaskMs ?? 0, r.pan?.longestTaskMs ?? 0, r.zoom?.longestTaskMs ?? 0)),
    );
    rows.push({
      fixture,
      dpr: Number(dpr),
      runs: rs.length,
      errors: rs.filter((r) => r.error).map((r) => r.error),
      firstTileMs: r1(median(ok.map((r) => r.open?.firstTileMs))),
      firstPartialMs: r1(median(ok.map((r) => r.open?.firstPartialMs ?? null))),
      openMs: r1(median(ok.map((r) => r.open?.openMs))),
      fetchMs: r1(median(ok.map((r) => r.open?.fetchMs))),
      panFpsP50: r1(median(ok.map((r) => r.pan?.fpsP50))),
      panFpsP5: r1(median(ok.map((r) => r.pan?.fpsP5))),
      zoomFpsP50: r1(median(ok.map((r) => r.zoom?.fpsP50))),
      zoomFpsP5: r1(median(ok.map((r) => r.zoom?.fpsP5))),
      longestMainTaskMsMaxOfRuns: r1(Number.isFinite(longestMain) ? longestMain : null),
      longTasksTotal: ok.reduce((n, r) => n + (r.openLongTasks ?? 0) + (r.pan?.longTasks ?? 0) + (r.zoom?.longTasks ?? 0), 0),
      peakCacheMb: r1(Math.max(...ok.map((r) => Math.max(r.pan?.peakCacheMb ?? 0, r.zoom?.peakCacheMb ?? 0)))),
      peakHeapMb: r1(Math.max(...ok.map((r) => Math.max(r.pan?.peakHeapMb ?? 0, r.zoom?.peakHeapMb ?? 0)))),
      previewRenderMs: r1(median(ok.map((r) => r.openTiles?.preview?.p50))),
      trace: rs.find((r) => r.trace)?.trace ?? null,
    });
  }
  return rows;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // Headed, and never throttled when another window covers it: Windows occlusion
  // detection otherwise drops rAF to 1 Hz mid-run (seen during the spike).
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--enable-precise-memory-info",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--window-position=0,0",
    ],
  });
  const env = {
    when: new Date().toISOString(),
    base,
    label,
    tile,
    pdfjs,
    progressive,
    browser: browser.version(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memGb: r1(os.totalmem() / 1073741824),
    freeMemGbAtStart: r1(os.freemem() / 1073741824),
    loadNote: "see report (Windows has no loadavg)",
  };
  console.error(`measuring ${fixtures.join(",")} x dpr ${dprs.join(",")} x ${runs} runs on ${env.browser}`);
  const results = [];
  for (const fixture of fixtures) {
    for (const dpr of dprs) {
      for (let run = 1; run <= runs; run++) {
        const t0 = Date.now();
        let r = await one(browser, fixture, dpr, run);
        // A 1 Hz frame cadence with no long task means Chrome throttled the
        // window (covered/occluded by the desktop), not that the page was slow:
        // retry such a run up to twice and keep the flag in the results.
        for (let attempt = 1; attempt <= 2 && throttled(r); attempt++) {
          console.error(`${fixture} dpr${dpr} run${run}: throttled window (1 Hz frames), retrying`);
          r = { ...(await one(browser, fixture, dpr, run)), retriedAfterThrottle: attempt };
        }
        r.throttled = throttled(r);
        console.error(
          `${fixture} dpr${dpr} run${run}: first tile ${r1(r.open?.firstTileMs)} ms (partial ${r1(r.open?.firstPartialMs)}), pan p50 ${r.pan?.fpsP50} fps, ` +
            `zoom p50 ${r.zoom?.fpsP50} fps${r.error ? `, ERROR ${r.error}` : ""} (${Math.round((Date.now() - t0) / 1000)} s)`,
        );
        results.push(r);
      }
    }
  }
  await browser.close();
  const summary = aggregate(results);
  const file = path.join(OUT, `results-${label}.json`);
  writeFileSync(file, JSON.stringify({ env, summary, results }, null, 2));
  console.log(JSON.stringify({ env, summary }, null, 2));
  console.error(`wrote ${path.relative(ROOT, file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
