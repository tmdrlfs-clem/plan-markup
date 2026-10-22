// Story 3.4, optional local-only check (never in CI: the L17/L21 drawings are
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-thumbnails
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// Opens each drawing, then the Thumbnails panel (Alt+T), and waits for the
// thumbnails: their labels, and the longest main-thread task (Long Tasks API)
// from opening the panel until the last thumbnail is drawn. Saves a screenshot
// of the workspace with the panel open to fixtures/private/traces/.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const MULTI = path.join(__dirname, "..", "fixtures", "pdf", "multi-page.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private L17/L21 drawings)");

async function openFile(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(file), mimeType: "application/pdf", buffer: readFileSync(file) });
  await expect(page.getByTestId("drawing-canvas")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

const startLongTasks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__longTasks = [];
    w.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration)));
    w.__observer.observe({ type: "longtask" });
  });

const stopLongTasks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
    w.__observer.disconnect();
    return Math.max(0, ...w.__longTasks);
  });

test("L17 / L21 / multi-page: thumbnails render with their labels, no main-thread task over 50 ms", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const panel = page.getByRole("complementary", { name: "Thumbnails" });
  const list = panel.getByRole("listbox", { name: "Page thumbnails" });
  const results: Record<string, number> = {};

  for (const [file, name] of [
    [L17, "Page 1, A1721"],
    [L21, "Page 1, A2121"],
  ] as const) {
    await openFile(page, file);
    await page.waitForTimeout(1500); // tiles settle
    if (await panel.count()) await page.keyboard.press("Alt+KeyT"); // close, to measure opening it
    await startLongTasks(page);
    await page.keyboard.press("Alt+KeyT");
    await expect(list.getByRole("option", { name, exact: true })).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await page.waitForTimeout(500);
    results[path.basename(file)] = await stopLongTasks(page);
  }

  await openFile(page, MULTI);
  await page.keyboard.press("Alt+KeyT"); // close
  await startLongTasks(page);
  await page.keyboard.press("Alt+KeyT");
  for (const name of ["Page 1, S-101", "Page 2, FP-201", "Page 3, FP-202", "Page 4"]) {
    await expect(list.getByRole("option", { name, exact: true })).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  }
  await page.waitForTimeout(500);
  results["multi-page.pdf"] = await stopLongTasks(page);
  process.stdout.write(`thumbnails longest main-thread task (ms): ${JSON.stringify(results)}\n`);
  for (const ms of Object.values(results)) expect(ms).toBeLessThan(50);

  // The workspace with the panel open, on L17.
  await openFile(page, L17);
  await expect(list.getByRole("option", { name: "Page 1, A1721", exact: true })).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  await page.screenshot({ path: path.join(PRIVATE, "traces", "3-4-thumbnails.png") });
  await context.close();
});
