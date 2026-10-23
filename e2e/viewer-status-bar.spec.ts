// Story 3.7: the status bar's page facts on the committed fixture
// fixtures/pdf/multi-page.pdf (4 pages of mixed sizes: A3 landscape, A4
// portrait, A3 portrait with /Rotate 90, A4 landscape). Item order, the page
// size per page, "Scale not set" with its icon, the snap toggles remembered
// across a reload, the cursor X/Y (and blank off the page), the zoom readout
// and its menu, and one line at 1280 px.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "multi-page.pdf");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const bar = (page: Page) => page.getByTestId("status-bar");
const item = (page: Page, id: string) => bar(page).getByTestId(id);

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "multi-page.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

test("status bar: order, page size per page, scale not set, snap toggles kept, cursor X/Y, zoom menu, one line at 1280 px", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await expect(bar(page)).toHaveText("No drawing open");
  await open(page);

  // Fixed order, left to right.
  const ids = ["status-file", "status-page-size", "status-scale", "status-snap", "status-cursor", "status-zoom"];
  const xs: number[] = [];
  for (const id of ids) xs.push((await item(page, id).boundingBox())!.x);
  const pager = (await bar(page).getByRole("group", { name: "Pages" }).boundingBox())!.x;
  expect([xs[0], pager, ...xs.slice(1)]).toEqual([...[xs[0], pager, ...xs.slice(1)]].sort((a, b) => a - b));

  // The page size follows the page (/Rotate applied).
  const size = item(page, "status-page-size");
  await expect(size).toHaveText("A3 420 × 297 mm");
  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(size).toHaveText("A4 210 × 297 mm");
  await page.keyboard.press("PageDown");
  await expect(size).toHaveText("A3 420 × 297 mm");
  await page.keyboard.press("PageDown");
  await expect(size).toHaveText("A4 297 × 210 mm");
  await page.keyboard.press("Home");
  await expect(size).toHaveText("A3 420 × 297 mm");

  // Scale not set: warning text with the warning icon (never colour alone).
  const scale = item(page, "status-scale");
  await expect(scale).toHaveText("Scale not set");
  await expect(scale.locator("svg.lucide-triangle-alert")).toHaveCount(1);

  // Cursor X/Y in PDF points: near the page's top-left corner X is small and Y near the
  // page height (A3 landscape: 842 pt, origin bottom-left); blank off the page.
  const cursor = item(page, "status-cursor-value");
  await expect(cursor).toHaveText("");
  const box = (await canvas(page).boundingBox())!;
  const view = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  const [zoom, centerX, centerY] = view;
  // Page point (20, 20) on screen (rotation 0).
  const sx = box.x + box.width / 2 + (20 - centerX) * zoom;
  const sy = box.y + box.height / 2 + (20 - centerY) * zoom;
  await page.mouse.move(sx, sy);
  await expect(cursor).toHaveText(/^X \d+\.\d {2}Y \d+\.\d pt$/);
  const [x, y] = ((await cursor.textContent()) ?? "").match(/[\d.]+/g)!.map(Number);
  expect(x).toBeGreaterThan(18);
  expect(x).toBeLessThan(22);
  expect(y).toBeGreaterThan(842 - 22);
  expect(y).toBeLessThan(842 - 18);
  await page.mouse.move(box.x + 3, box.y + 3); // the padding around the fitted page
  await expect(cursor).toHaveText("");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(cursor).not.toHaveText("");
  await page.mouse.move(box.x + box.width / 2, box.y - 40); // off the canvas
  await expect(cursor).toHaveText("");

  // Zoom readout and its menu.
  const zoomItem = item(page, "status-zoom");
  await expect(zoomItem).toHaveText(/^\d+%$/);
  await zoomItem.click();
  await page.getByRole("menuitem", { name: "100%" }).click();
  await expect(zoomItem).toHaveText("100%");
  await zoomItem.click();
  await page.getByRole("menuitem", { name: /Fit page/ }).click();
  await expect(zoomItem).not.toHaveText("100%");

  // Snap toggles: remembered per user across a reload.
  const grid = bar(page).getByRole("button", { name: "Snap to grid" });
  const content = bar(page).getByRole("button", { name: "Snap to content" });
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await expect(content).toHaveAttribute("aria-pressed", "true");
  await grid.click();
  await content.click();
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await open(page);
  await expect(bar(page).getByRole("button", { name: "Snap to grid" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page).getByRole("button", { name: "Snap to content" })).toHaveAttribute("aria-pressed", "false");
  // Back to the defaults for the other tests of this user.
  await bar(page).getByRole("button", { name: "Snap to grid" }).click();
  await bar(page).getByRole("button", { name: "Snap to content" }).click();

  // 1280 px: one 24 px line, nothing cut off; the page size becomes an icon with a tooltip.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(item(page, "status-page-size")).toBeHidden();
  await expect(item(page, "status-page-size-icon")).toBeVisible();
  const fits = await bar(page).evaluate((el) => ({ height: el.getBoundingClientRect().height, overflow: el.scrollWidth - el.clientWidth }));
  expect(fits).toEqual({ height: 24, overflow: 0 });
  for (const id of ["status-scale", "status-snap", "status-cursor", "status-zoom"]) {
    const b = (await item(page, id).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
  }
  await context.close();
});
