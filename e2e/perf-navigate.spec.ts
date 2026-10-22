// Story 3.2, optional local-only perf check (never in CI: the L17 fixture is
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-navigate
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// 5 s of scripted pan and zoom on the L17 RCP: frame times from rAF timestamps
// (p50 and p95, i.e. the 5th-percentile frame rate) and the longest main-thread
// task (Long Tasks API). Then a zoomed-in screenshot for a visual sharpness check.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const L17 = path.join(__dirname, "..", "fixtures", "private", "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const TRACES = path.join(__dirname, "..", "fixtures", "private", "traces");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17), "local perf check: set PERF_L17=1 (needs the private L17 fixture)");

test("L17: 5 s of pan and zoom keep frames under budget", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "L17.pdf", mimeType: "application/pdf", buffer: readFileSync(L17) });
  const canvas = page.getByTestId("drawing-canvas");
  await expect(canvas).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const result = await canvas.evaluate(async (el) => {
    const c = el as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
    observer.observe({ type: "longtask" });
    const wheel = (init: WheelEventInit) =>
      c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.6, clientY: r.y + r.height * 0.4, ...init }));
    const frames: number[] = [];
    const start = performance.now();
    let last = start;
    await new Promise<void>((done) => {
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        const t = now - start;
        // 0-1.5 s zoom in, 1.5-3 s pan, 3-3.3 s idle (tiles settle), 3.3-4.3 s pan, 4.3-5 s zoom out.
        if (t < 1500) wheel({ deltaY: -12, ctrlKey: true });
        else if (t < 3000) wheel({ deltaX: Math.sin(t / 300) * 25, deltaY: 18 });
        else if (t < 3300) {
          /* idle */
        } else if (t < 4300) wheel({ deltaX: -20, deltaY: -10 });
        else if (t < 5000) wheel({ deltaY: 12, ctrlKey: true });
        if (t < 5000) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame((now) => {
        last = now;
        requestAnimationFrame(tick);
      });
    });
    observer.disconnect();
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    return { frames: frames.length, p50: pct(50), p95: pct(95), max: sorted.at(-1), longestTask: Math.max(0, ...longTasks), longTasks: longTasks.length };
  });
  process.stdout.write(`L17 perf: ${JSON.stringify(result)}\n`);

  // Zoom into a detailed area exactly at a bucket scale (buckets are absolute: 2^k device px
  // per point; here 2 CSS px per point at DPR 1 = bucket 1), let the tiles land, then screenshot.
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Fit page" }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const target = 2 / dpr;
  for (let i = 0; i < 4; i++) {
    const zoom = Number((await canvas.getAttribute("data-view"))!.split(" ")[0]);
    if (Math.abs(zoom / target - 1) < 1e-9) break;
    // One 100 px Ctrl+wheel notch is one √2 step (viewer-input wheelZoomFactor), at most 4 per event.
    const dy = Math.max(-400, Math.min(400, -200 * Math.log2(target / zoom)));
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, dy);
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(4000);
  mkdirSync(TRACES, { recursive: true });
  const shot = path.join(TRACES, "3-2-l17-zoom.png");
  await canvas.screenshot({ path: shot });
  process.stdout.write(`L17 screenshot: ${shot} view=${await canvas.getAttribute("data-view")}\n`);

  expect(result.p50).toBeLessThan(1000 / 30);
  await context.close();
});
