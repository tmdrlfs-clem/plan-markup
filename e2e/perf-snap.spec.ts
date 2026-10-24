// Story 4.1, optional local-only check (never in CI: the drawings are private
// and git-ignored). Run: PERF_L17=1 npx playwright test perf-snap
// (production build: E2E_PROD=1 after `npm run build`; PERF_A0=1 adds the
// synthetic A0).
//
// For each drawing: the time from "ready" to the snap index being there, the
// worker's own numbers (operator list, extraction, build, bytes), the segment
// count; then, with Length armed at ~200 %, a 3 s pointer sweep: frame deltas
// (rAF) and the longest main-thread task (Long Tasks API). L17 also gets a
// screenshot of an endpoint glyph: fixtures/private/traces/4-1-snap.png.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const FILES = {
  L17: path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf"),
  L21: path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf"),
  A0: path.join(PRIVATE, "pdf", "synthetic-a0-50mb.pdf"),
};

test.skip(process.env.PERF_L17 !== "1" || !existsSync(FILES.L17) || !existsSync(FILES.L21), "local check: set PERF_L17=1 (needs the private drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __frames: number[]; __raf: boolean };
    w.__long = [];
    w.__frames = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask" });
  });
}

async function measure(page: Page, name: keyof typeof FILES) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(FILES[name]);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const readyAt = Date.now();
  await page.evaluate(() => ((window as unknown as { __long: number[] }).__long.length = 0));
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+/, { timeout: 120_000 });
  const indexMs = Date.now() - readyAt;
  const longDuringBuild = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
  const [opListMs, extractMs, buildMs, bytes] = ((await canvas(page).getAttribute("data-snap-build")) ?? "").split(" ").map(Number);
  const segments = await canvas(page).getAttribute("data-snap-index");

  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Length" }).click();
  await page.getByTestId("status-bar").getByTestId("status-zoom").click();
  await page.getByRole("menuitem", { name: "200%" }).click();
  await page.waitForTimeout(500);
  const box = (await canvas(page).boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __frames: number[]; __raf: boolean };
    w.__long.length = 0;
    w.__frames = [];
    w.__raf = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__raf) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const start = Date.now();
  let i = 0;
  let snapped = 0;
  while (Date.now() - start < 3000) {
    const t = (i++ % 200) / 200;
    await page.mouse.move(box.x + box.width * (0.2 + 0.6 * t), box.y + box.height * (0.3 + 0.4 * Math.sin(t * 6.28)));
    if (i % 10 === 0 && (await canvas(page).getAttribute("data-snap"))) snapped++;
  }
  const sweep = await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __frames: number[]; __raf: boolean };
    w.__raf = false;
    const f = w.__frames.slice(1).sort((a, b) => a - b);
    const fps = (q: number) => Math.round(1000 / f[Math.min(f.length - 1, Math.floor(q * f.length))]);
    return { moves: 0, fpsP50: fps(0.5), fpsP5: fps(0.95), longest: Math.round(Math.max(0, ...w.__long)) };
  });
  sweep.moves = i;

  if (name === "L17") {
    // Find an endpoint and keep the glyph on screen for the screenshot.
    for (let k = 0; k < 400; k++) {
      const t = k / 400;
      await page.mouse.move(box.x + box.width * (0.3 + 0.4 * t), box.y + box.height * (0.35 + 0.3 * ((k * 7) % 13) / 13));
      if ((await canvas(page).getAttribute("data-snap"))?.startsWith("endpoint")) break;
    }
    mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
    await page.screenshot({ path: path.join(PRIVATE, "traces", "4-1-snap.png") });
  }
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select" }).click();
  return { name, segments, indexMs, opListMs, extractMs, buildMs, indexMB: +(bytes / 1e6).toFixed(1), longDuringBuild: Math.round(longDuringBuild), sweep, snappedSamples: snapped };
}

test("snap index and pointer sweep on L17, L21 (and A0)", async ({ browser }) => {
  test.setTimeout(600_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await watch(page);
  const results = [await measure(page, "L17"), await measure(page, "L21")];
  if (process.env.PERF_A0 === "1" && existsSync(FILES.A0)) results.push(await measure(page, "A0"));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  for (const r of results) expect(r.sweep.longest).toBeLessThan(50);
  await context.close();
});
