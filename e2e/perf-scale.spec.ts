// Story 4.2, optional local-only check (never in CI: the drawings are private
// and git-ignored). Run: PERF_L17=1 npx playwright test perf-scale
// (production build: E2E_PROD=1 after `npm run build`).
//
// What the founder's L17 and L21 detect: both title blocks say "SCALE As
// indicated", which must give no scale; L21's view title states 1:75 @ A1
// and 1:200 @ A3, which disagree (4.2 review D1). Prints the ScaleIndicator
// text and tooltip of each and saves fixtures/private/traces/4-2-scale.png
// (L21 with the tooltip open).
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");

async function openAndRead(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(file);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  // Detection follows the page text (after tiles): wait for its answer (review D7).
  await expect(scale(page)).toHaveAttribute("data-detection", "done", { timeout: 30_000 });
  const text = await scale(page).textContent();
  await scale(page).hover();
  const tooltip = await page.getByRole("tooltip").textContent({ timeout: 3000 }).catch(() => null);
  await page.mouse.move(5, 500);
  return { file: path.basename(file), text, tooltip };
}

test("L17 and L21: what the status bar detects", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const l17 = await openAndRead(page, L17);
  const l21 = await openAndRead(page, L21);
  process.stdout.write(`${JSON.stringify([l17, l21], null, 2)}\n`);
  // L17: only "As indicated" in its title block: nothing detected.
  expect(l17.text).toBe("Scale not set");
  // L21: the view title's two sheet statements disagree.
  expect(l21.text).toBe("Scales disagree — Verify");
  expect(l21.tooltip).toContain("1:75 @ A1 = 1:75 on this A1 page; 1:200 @ A3 = 1:100 on this A1 page");
  await scale(page).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  await page.screenshot({ path: path.join(PRIVATE, "traces", "4-2-scale.png") });
  await context.close();
});
