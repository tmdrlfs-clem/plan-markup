// Story 9.13 (NFR6), optional local-only measurement (never in CI: timings on a shared
// runner say nothing). Run on the reference hardware against the production build:
//   npm run build && E2E_PROD=1 PERF_M2=1 npx playwright test perf-4541
//
// snap.pdf page 1 (A4 landscape) at 1:100 is a 29.7 × 21 m sheet. Measured, from the click
// on Place heads to the status line saying the run is done (so with the worker round trip,
// the markups written and the panel painted), and the main-thread tasks over 50 ms from the
// click until a second after the run (the coverage overlay fading in, the zones checked again):
//   1. one zone of 196 m² (14 × 14 m);           NFR6: ≤ 1 s
//   2. a floor of 15 zones, 600 m² (5 × 3 rooms); NFR6: ≤ 5 s
// Both must show no main-thread task over 50 ms. The numbers go to docs/spikes/m2-timings.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

test.skip(process.env.PERF_M2 !== "1", "local check: set PERF_M2=1 (production build, reference hardware)");

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByTestId("sprinkler-panel");

/** Screen position of user space point (x, y) on the unrotated A4 page. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
}

/** Draws a rectangular polygon zone (points; Alt held, so nothing snaps). */
async function drawZone(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const polygon = panel(page).getByRole("button", { name: "Polygon zone" });
  if ((await polygon.getAttribute("aria-pressed")) !== "true") await polygon.click();
  await page.keyboard.down("Alt");
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]) {
    const at = await screenOf(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.up("Alt");
  await page.keyboard.press("Enter");
}

/** Clicks Place heads; the time to the done status line and the long tasks in between (ms, measured in the page). */
async function timedPlace(page: Page, zones: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __m2?: { t0: number; t1: number; before: string; long: { start: number; ms: number }[] } };
    if (!w.__m2) {
      const m = (w.__m2 = { t0: 0, t1: 0, before: "", long: [] as { start: number; ms: number }[] });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) m.long.push({ start: e.startTime, ms: Math.round(e.duration) });
      }).observe({ type: "longtask" });
      const root = document.querySelector("[data-testid='sprinkler-panel']")!;
      const text = () => root.querySelector("[data-testid='place-status']")?.textContent ?? "";
      root.querySelector("[data-testid='place-heads']")!.addEventListener(
        "click",
        () => {
          m.t0 = performance.now();
          m.t1 = 0;
          m.before = text();
        },
        { capture: true },
      );
      new MutationObserver(() => {
        const now = text();
        if (m.t0 && !m.t1 && now !== m.before && /placed in \d+ zones?\.$/.test(now)) m.t1 = performance.now();
      }).observe(root, { subtree: true, childList: true, characterData: true });
    }
  });
  await panel(page).getByTestId("place-heads").click();
  await expect(panel(page).getByTestId("place-status")).toHaveText(new RegExp(`^\\d+ heads placed in ${zones} zones?\\.$`), { timeout: 30_000 });
  // The second after the run counts too: the coverage overlay fades in and each zone is checked again.
  await page.waitForTimeout(1_300);
  return page.evaluate(() => {
    const m = (window as unknown as { __m2: { t0: number; t1: number; long: { start: number; ms: number }[] } }).__m2;
    return { ms: Math.round(m.t1 - m.t0), long: m.long.filter((l) => l.start + l.ms >= m.t0 && l.start <= m.t1 + 1_000).map((l) => l.ms) };
  });
}

test("NFR6: one 196 m² zone and a 600 m² floor of 15 zones, timed, with no long main-thread task", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await canvas(page).focus();
  await page.keyboard.press("Alt+4");
  await page.getByTestId("sprinkler-calibrate-first").getByRole("button", { name: "Calibrate" }).click();
  const dialog = page.getByRole("dialog", { name: "Calibrate" });
  await dialog.getByTestId("calibrate-ratio").fill("1:100");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  // 1. One zone, 14 × 14 m = 196 m² (1 pt = 35.28 mm at 1:100: 397 pt).
  const rows = panel(page).getByTestId("zone-row");
  await drawZone(page, 20, 20, 417, 417);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/19[5-7]\.\d m²/);
  const single = await timedPlace(page, 1);
  const singleHeads = await panel(page).getByTestId("place-status").textContent();
  process.stdout.write(`[m2] single zone 196 m²: ${single.ms} ms, long tasks ${JSON.stringify(single.long)} (${singleHeads})
`);

  // Clear the page (the zone and its heads).
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true }).click();
  await canvas(page).focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(panel(page).getByTestId("zones-empty")).toBeVisible();

  // 2. Fifteen rooms, 5 × 3, each 165 × 195 pt = 5.82 × 6.88 m = 40 m²: a 600 m² floor.
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) await drawZone(page, 8 + c * 165, 5 + r * 195, 8 + (c + 1) * 165, 5 + (r + 1) * 195);
  await expect(rows).toHaveCount(15);
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true }).click();
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByTestId("place-heads")).toHaveText("Place heads");
  const floor = await timedPlace(page, 15);
  const floorHeads = await panel(page).getByTestId("place-status").textContent();
  process.stdout.write(`[m2] floor 15 zones 600 m²: ${floor.ms} ms, long tasks ${JSON.stringify(floor.long)} (${floorHeads})
`);
  await expect(panel(page).getByTestId("zone-check")).toHaveCount(15);

  // 3. Beyond NFR6 (PERF_M2_BIG=1): 45 rooms, 9 × 5, each 91 × 117 pt = 3.2 × 4.1 m; reported, not asserted.
  if (process.env.PERF_M2_BIG === "1") {
    await canvas(page).focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await expect(panel(page).getByTestId("zones-empty")).toBeVisible();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) await drawZone(page, 10 + c * 91, 5 + r * 117, 10 + (c + 1) * 91, 5 + (r + 1) * 117);
    await expect(rows).toHaveCount(45);
    await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true }).click();
    await canvas(page).focus();
    await page.keyboard.press("Escape");
    const big = await timedPlace(page, 45);
    process.stdout.write(`[m2] 45 zones: ${big.ms} ms, long tasks ${JSON.stringify(big.long)} (${await panel(page).getByTestId("place-status").textContent()})
`);
  }

  expect(single.ms, "one zone ≤ 200 m² in ≤ 1 s").toBeLessThanOrEqual(1_000);
  expect(floor.ms, "a 600 m² floor of 15 zones in ≤ 5 s").toBeLessThanOrEqual(5_000);
  expect([...single.long, ...floor.long], "no main-thread task over 50 ms while placing").toEqual([]);
});
