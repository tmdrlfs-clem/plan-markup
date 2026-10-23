// Story 3.7 review, optional local-only check (never in CI: the L17 drawing is
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-tiles
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// The founder's case: on L17 at ~190 % the tiles took up to 10 s to fill after
// a jump (go-to-hit). Opens L17 in a fresh browser context (empty raster
// cache), searches "CH +2700" and moves through four hits; for each jump it
// records, from the engine's opt-in tile log (window.__pmTilePerf), how long
// until every in-view tile was in and until every requested tile was in,
// the tile count, the worker's render and queue times, and cache hits.
// Writes the numbers to fixtures/private/traces/tile-fill-<label>.json and the
// first jump's view to tile-fill-<label>.png (PERF_LABEL, default "run").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17), "local check: set PERF_L17=1 (needs the private L17 drawing)");

type Entry = { at: number; page: number; bucket: number; inView: boolean; fromCache: boolean; renderMs: number; waitMs: number };

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByTestId("search-panel");

const pct = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

test("L17: tile fill after a go-to-hit jump at ~190 %", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(() => {
    (window as unknown as { __pmTilePerf: unknown[] }).__pmTilePerf = [];
  });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(L17), mimeType: "application/pdf", buffer: readFileSync(L17) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(canvas(page)).toHaveAttribute("data-pending-tiles", "0", { timeout: 30_000 });

  await canvas(page).focus();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("CH +2700");
  await expect(panel(page).getByTestId("search-status")).toHaveText(/^\d+ results? on 1 page$/, { timeout: 20_000 });

  const jumps: Record<string, unknown>[] = [];
  for (let i = 0; i < 5; i++) {
    // The fifth jump wraps around to an earlier hit (Shift+Enter): tiles already in memory.
    const from = await page.evaluate(() => performance.now());
    await page.keyboard.press(i === 4 ? "Shift+Enter" : "Enter");
    await page.waitForTimeout(400); // the settle delay, so the new view's requests are in flight
    await expect(canvas(page)).toHaveAttribute("data-pending-tiles", "0", { timeout: 120_000 });
    const zoom = await page.getByTestId("status-bar").getByTestId("status-zoom").textContent();
    const log = await page.evaluate((t) => (window as unknown as { __pmTilePerf: Entry[] }).__pmTilePerf.filter((e) => e.at >= t), from);
    const inView = log.filter((e) => e.inView);
    const rendered = log.filter((e) => !e.fromCache);
    jumps.push({
      jump: i + 1,
      zoom,
      buckets: [...new Set(log.map((e) => e.bucket))],
      tiles: log.length,
      inViewTiles: inView.length,
      fromCache: log.length - rendered.length,
      inViewFilledMs: inView.length ? Math.round(Math.max(...inView.map((e) => e.at)) - from) : 0,
      allFilledMs: log.length ? Math.round(Math.max(...log.map((e) => e.at)) - from) : 0,
      firstTileMs: log.length ? Math.round(Math.min(...log.map((e) => e.at)) - from) : 0,
      renderMsP50: pct(rendered.map((e) => e.renderMs), 50),
      renderMsP95: pct(rendered.map((e) => e.renderMs), 95),
      renderMsSum: Math.round(rendered.reduce((s, e) => s + e.renderMs, 0)),
      waitMsMax: Math.round(Math.max(0, ...log.map((e) => e.waitMs))),
    });
    // The first jump's view with every tile in, to review the culled tiles by eye.
    if (i === 0) {
      mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
      await page.screenshot({ path: path.join(PRIVATE, "traces", `tile-fill-${process.env.PERF_LABEL ?? "run"}.png`) });
    }
  }

  const result = { label: process.env.PERF_LABEL ?? "run", dpr: await page.evaluate(() => devicePixelRatio), jumps };
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  writeFileSync(path.join(PRIVATE, "traces", `tile-fill-${result.label}.json`), JSON.stringify(result, null, 2));
  await context.close();
});
