// Story 3.6, optional local-only check (never in CI: the L17/L21 drawings are
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-search
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// Opens L17 and L21 in two tabs and searches both: the expected hit counts,
// the highlight of the current hit over the drawing's text (ink under the
// highlight at the canvas centre, where a revealed hit is centred), and the
// longest main-thread task (Long Tasks API) while typing, matching and moving
// between hits. Saves a screenshot with highlights to fixtures/private/traces/.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private L17/L21 drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByTestId("search-panel");
const field = (page: Page) => panel(page).getByRole("textbox", { name: "Find" });
const status = (page: Page) => panel(page).getByTestId("search-status");

async function openFile(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(file), mimeType: "application/pdf", buffer: readFileSync(file) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

/**
 * Pixels in a box at the canvas centre (device px): dark ink on the tiles
 * layer, and highlight pixels (any opaque pixel) on the active layer.
 */
async function centrePixels(page: Page, halfWidth: number, halfHeight: number) {
  return page.evaluate(
    ({ hw, hh }) => {
      const tiles = document.querySelector<HTMLCanvasElement>("[data-testid='tiles-canvas']")!;
      const active = document.querySelector<HTMLCanvasElement>("[data-testid='drawing-canvas']")!;
      const cx = Math.round(tiles.width / 2);
      const cy = Math.round(tiles.height / 2);
      const read = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(cx - hw, cy - hh, hw * 2, hh * 2).data;
      const t = read(tiles);
      const a = read(active);
      let ink = 0;
      let marked = 0;
      for (let i = 0; i < t.length; i += 4) {
        if (t[i] + t[i + 1] + t[i + 2] < 300) ink++;
        if (a[i + 3] > 0) marked++;
      }
      return { ink, marked, total: t.length / 4 };
    },
    { hw: halfWidth, hh: halfHeight },
  );
}

test("L17 + L21: search finds the expected hits, the highlight sits on the text, no main-thread task over 50 ms", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await openFile(page, L21);
  await openFile(page, L17);

  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__longTasks = [];
    w.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration)));
    w.__observer.observe({ type: "longtask" });
  });

  // L17: Ctrl+F, type, count.
  await canvas(page).focus();
  await page.keyboard.press("Control+f");
  await expect(field(page)).toBeFocused();
  const t0 = Date.now();
  await page.keyboard.type("CH +2700", { delay: 40 });
  await expect(status(page)).toHaveText(/^\d+ results? on 1 page$/, { timeout: 20_000 });
  const typedToResultsMs = Date.now() - t0;
  const l17Text = (await status(page).textContent()) ?? "";
  const l17Hits = Number(l17Text.split(" ")[0]);
  expect(l17Hits).toBe(14);
  await expect(canvas(page)).toHaveAttribute("data-highlights", String(l17Hits));

  // Move through the hits: each is revealed (zoomed so the text is at least 24 px, centred).
  const centres: { ink: number; marked: number; total: number }[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Enter");
    await expect(canvas(page)).toHaveAttribute("data-highlights", `${l17Hits} current`);
    await page.waitForTimeout(1500); // tiles of the new view
    centres.push(await centrePixels(page, 20, 8));
  }
  // The highlight covers the canvas centre and there is drawing ink under it (the label's glyphs).
  for (const c of centres) {
    expect(c.marked).toBeGreaterThan(c.total * 0.8);
    expect(c.ink).toBeGreaterThan(10);
  }

  // Whole word "D1" on L17.
  await field(page).fill("D1");
  await panel(page).getByRole("button", { name: "Whole word" }).click();
  await expect(status(page)).toHaveText(/^\d+ results? on 1 page$/, { timeout: 20_000 });
  const d1 = Number(((await status(page).textContent()) ?? "").split(" ")[0]);
  expect(d1).toBeGreaterThanOrEqual(31);

  // L21 in the other tab: its own search.
  await canvas(page).focus();
  await page.keyboard.press("Alt+PageUp");
  await expect(field(page)).toHaveValue("");
  await field(page).fill("CH +2700");
  await expect(status(page)).toHaveText(/^(\d+ results? on 1 page|No results)$/, { timeout: 20_000 });
  const l21Text = (await status(page).textContent()) ?? "";

  // Back on L17: the search is still there; show its first hit for the screenshot.
  await canvas(page).focus();
  await page.keyboard.press("Alt+PageDown");
  await expect(field(page)).toHaveValue("D1");
  await field(page).fill("CH +2700");
  await expect(status(page)).toHaveText(`${l17Hits} results on 1 page`);
  await field(page).press("Enter");
  await page.waitForTimeout(2000);

  const longest = await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__observer.disconnect();
    return Math.max(0, ...w.__longTasks);
  });
  process.stdout.write(
    `search: L17 "CH +2700" ${l17Hits} hits (typed to results ${typedToResultsMs} ms), whole-word "D1" ${d1}; L21 "CH +2700": ${l21Text}; ` +
      `centre pixels ${JSON.stringify(centres)}; longest main-thread task ${longest} ms\n`,
  );
  expect(longest).toBeLessThan(50);
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  await page.screenshot({ path: path.join(PRIVATE, "traces", "3-6-search.png") });
  await context.close();
});
