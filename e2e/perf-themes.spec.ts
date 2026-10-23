// Story 3.8, optional local-only check (never in CI: the L17 drawing is
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-themes
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// L17 in Blueprint, Daylight and High contrast with a search open (highlights
// on the sheet): a screenshot per theme to fixtures/private/traces/
// 3-8-theme-<name>.png, the longest main-thread task while switching, and
// that switching renders no tile again (the pending-tile count stays 0).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const LABEL = { blueprint: "Blueprint", daylight: "Daylight", contrast: "High contrast" } as const;

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17), "local check: set PERF_L17=1 (needs the private L17 drawing)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function choose(page: Page, theme: keyof typeof LABEL) {
  await page.getByRole("menubar", { name: "Main menu" }).getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: LABEL[theme] }).click();
  await expect(page.getByTestId("workspace-root")).toHaveAttribute("data-theme", theme);
}

test("L17 in the three themes: screenshots, no long task, no tile rendered again", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "theme@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  if ((await page.getByTestId("workspace-root").getAttribute("data-theme")) !== "blueprint") await choose(page, "blueprint");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(L17), mimeType: "application/pdf", buffer: readFileSync(L17) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await canvas(page).focus();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("CH +2700");
  await expect(page.getByTestId("search-panel").getByTestId("search-status")).toHaveText(/results? on 1 page$/, { timeout: 20_000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await expect(canvas(page)).toHaveAttribute("data-pending-tiles", "0", { timeout: 60_000 });

  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: "longtask" });
  });
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  const pendingAfterSwitch: number[] = [];
  for (const theme of ["blueprint", "daylight", "contrast"] as const) {
    if (theme !== "blueprint") await choose(page, theme);
    await page.mouse.move(5, 500); // no hover state in the screenshot
    pendingAfterSwitch.push(Number(await canvas(page).getAttribute("data-pending-tiles")));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(PRIVATE, "traces", `3-8-theme-${theme}.png`) });
  }
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
  process.stdout.write(`themes: longest main-thread task while switching ${Math.round(longest)} ms; pending tiles after each switch ${JSON.stringify(pendingAfterSwitch)}\n`);
  expect(pendingAfterSwitch).toEqual([0, 0, 0]);
  expect(longest).toBeLessThan(50);
  await choose(page, "blueprint");
  await context.close();
});
