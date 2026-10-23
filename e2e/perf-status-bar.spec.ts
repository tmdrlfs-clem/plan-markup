// Story 3.7, optional local-only check (never in CI: the L17/L21 drawings are
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-status-bar
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// Opens L17 and L21 in two tabs: the sheet size each shows, the cursor
// readout at known page points (and after zooming and rotating the view), and
// the longest main-thread task (Long Tasks API) while the pointer sweeps the
// canvas for a few seconds. Saves a screenshot to fixtures/private/traces/.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private L17/L21 drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const item = (page: Page, id: string) => page.getByTestId("status-bar").getByTestId(id);

async function openFile(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(file), mimeType: "application/pdf", buffer: readFileSync(file) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

/** Screen position (page coordinates) of a page-space point for the current view (rotation 0 or 90). */
async function screenOf(page: Page, px: number, py: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy, rotation] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  const dx = (px - cx) * zoom;
  const dy = (py - cy) * zoom;
  const [rx, ry] = rotation === 90 ? [-dy, dx] : [dx, dy];
  return { x: box.x + box.width / 2 + rx, y: box.y + box.height / 2 + ry };
}

async function readout(page: Page) {
  const text = (await item(page, "status-cursor").textContent()) ?? "";
  const [x, y] = text.match(/[\d.]+/g)?.map(Number) ?? [Number.NaN, Number.NaN];
  return { text, x, y };
}

test("L17 + L21: A1 sheet detected, cursor X/Y sane, no main-thread task over 50 ms while the pointer moves", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await openFile(page, L21);
  await expect(item(page, "status-page-size")).toHaveText("A1 841 × 594 mm");
  await openFile(page, L17);
  await expect(item(page, "status-page-size")).toHaveText("A1 841 × 594 mm");

  // L17 is 2384 x 1684 pt: page point (100, 100) from the top-left is PDF (100, 1584).
  const checks: string[] = [];
  const at = async (label: string, px: number, py: number) => {
    const s = await screenOf(page, px, py);
    await page.mouse.move(s.x, s.y);
    await expect(item(page, "status-cursor")).not.toHaveText("");
    const r = await readout(page);
    checks.push(`${label}: ${r.text}`);
    return r;
  };
  let r = await at("fit, page (100, 100)", 100, 100);
  expect(Math.abs(r.x - 100)).toBeLessThan(3);
  expect(Math.abs(r.y - 1584)).toBeLessThan(3);
  r = await at("fit, page centre", 1192, 842);
  expect(Math.abs(r.x - 1192)).toBeLessThan(3);
  expect(Math.abs(r.y - 842)).toBeLessThan(3);

  // Zoomed in and the view rotated: the same page point gives the same PDF point.
  await canvas(page).focus();
  await page.keyboard.press("=");
  await page.keyboard.press("=");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Rotate view clockwise" }).click();
  await expect(canvas(page)).toHaveAttribute("data-view", / 90$/);
  r = await at("zoomed and rotated 90°, page centre", 1192, 842);
  expect(Math.abs(r.x - 1192)).toBeLessThan(2);
  expect(Math.abs(r.y - 842)).toBeLessThan(2);
  r = await at("zoomed and rotated 90°, page (1100, 800)", 1100, 800);
  expect(Math.abs(r.x - 1100)).toBeLessThan(2);
  expect(Math.abs(r.y - 884)).toBeLessThan(2);
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Rotate view counter-clockwise" }).click();
  r = await at("zoomed, page centre", 1192, 842);
  expect(Math.abs(r.x - 1192)).toBeLessThan(2);
  expect(Math.abs(r.y - 842)).toBeLessThan(2);

  // Pointer sweep: ~3 s of moves, one per frame, measured with the Long Tasks API.
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__longTasks = [];
    w.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration)));
    w.__observer.observe({ type: "longtask" });
  });
  const box = (await canvas(page).boundingBox())!;
  const t0 = Date.now();
  let moves = 0;
  while (Date.now() - t0 < 3000) {
    const t = moves / 180;
    await page.mouse.move(box.x + box.width * (0.1 + 0.8 * t), box.y + box.height * (0.5 + 0.4 * Math.sin(t * 12)));
    moves++;
  }
  const longest = await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__observer.disconnect();
    return Math.max(0, ...w.__longTasks);
  });

  // Back to fit for the screenshot, the pointer on the drawing.
  await canvas(page).focus();
  await page.keyboard.press("Control+9");
  const s = await screenOf(page, 1192, 842);
  await page.mouse.move(s.x, s.y);
  await expect(item(page, "status-cursor")).not.toHaveText("");
  process.stdout.write(
    `status bar: L21 and L17 "${await item(page, "status-page-size").textContent()}"; ${checks.join("; ")}; ` +
      `pointer sweep ${moves} moves in 3 s, longest main-thread task ${longest} ms; zoom ${await item(page, "status-zoom").textContent()}\n`,
  );
  expect(longest).toBeLessThan(50);
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  await page.screenshot({ path: path.join(PRIVATE, "traces", "3-7-status-bar.png") });
  await context.close();
});
