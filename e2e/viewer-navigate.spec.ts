// Story 3.2: zoom, pan, fit and rotate the view. Wheel scroll, Ctrl+wheel zoom
// around the cursor, Space-drag, keyboard zoom, Fit page/width, rotate, the Zoom
// and Pan tools, and the browser-zoom suppression on the canvas. The canvas
// publishes its view as data-view="zoom centerX centerY rotation" (page points).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const ADMIN = "admin@plan-markup.test";
const FIXTURE = path.join(__dirname, "..", "fixtures", "pdf", "vector-a3.pdf");
const SQRT2 = Math.SQRT2;

test.describe.configure({ mode: "serial" });

let storageState: BrowserContextOptions["storageState"];

type View = { zoom: number; cx: number; cy: number; rotation: number };
/** The status-bar zoom: percent of actual size, 100 % = 96/72 CSS px per point (Revu). */
const percent = (zoom: number) => Math.round((zoom * 72 * 100) / 96);

async function openDrawing(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState });
  const page = await context.newPage();
  if (!storageState) {
    await page.goto("/sign-in");
    await signIn(page, ADMIN);
    await expect(page).toHaveURL("/workspace");
    storageState = await context.storageState();
  } else {
    await page.goto("/workspace");
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "vector-a3.pdf", mimeType: "application/pdf", buffer: readFileSync(FIXTURE) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  return page;
}

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function view(page: Page): Promise<View> {
  const text = (await canvas(page).getAttribute("data-view")) ?? "";
  const [zoom, cx, cy, rotation] = text.split(" ").map(Number);
  return { zoom, cx, cy, rotation };
}

/** Waits until the published view differs from `before`, then returns it. */
async function nextView(page: Page, before: View): Promise<View> {
  await expect.poll(async () => JSON.stringify(await view(page))).not.toBe(JSON.stringify(before));
  return view(page);
}

async function box(page: Page) {
  const b = await canvas(page).boundingBox();
  if (!b) throw new Error("canvas has no box");
  return b;
}

/** The page point under a viewport point (rotation 0). */
function pageAt(v: View, size: { width: number; height: number }, at: { x: number; y: number }) {
  return { x: v.cx + (at.x - size.width / 2) / v.zoom, y: v.cy + (at.y - size.height / 2) / v.zoom };
}

test("wheel scrolls, Shift+wheel scrolls sideways, Ctrl+wheel zooms around the cursor", async ({ browser }) => {
  const page = await openDrawing(browser);
  const b = await box(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const fit = await view(page);
  await expect(page.getByRole("contentinfo")).toContainText(`${percent(fit.zoom)}%`);

  await page.mouse.wheel(0, 120);
  const scrolled = await nextView(page, fit);
  expect(scrolled.zoom).toBe(fit.zoom);
  expect(scrolled.cy - fit.cy).toBeCloseTo(120 / fit.zoom, 1);
  expect(scrolled.cx).toBeCloseTo(fit.cx, 3);

  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Shift");
  const sideways = await nextView(page, scrolled);
  expect(sideways.cx - scrolled.cx).toBeCloseTo(100 / fit.zoom, 1);
  expect(sideways.cy).toBeCloseTo(scrolled.cy, 3);

  // Ctrl+wheel over a point off-centre: that page point stays under the cursor.
  const at = { x: b.width * 0.25, y: b.height * 0.3 };
  await page.mouse.move(b.x + at.x, b.y + at.y);
  const anchor = pageAt(sideways, b, at);
  const dpr = await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1]);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  const zoomed = await nextView(page, sideways);
  expect(zoomed.zoom / sideways.zoom).toBeCloseTo(SQRT2, 3);
  const after = pageAt(zoomed, b, at);
  expect(after.x).toBeCloseTo(anchor.x, 0);
  expect(after.y).toBeCloseTo(anchor.y, 0);
  // The browser did not zoom the page.
  expect(await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1])).toEqual(dpr);
  await expect(page.getByRole("contentinfo")).toContainText(`${percent(zoomed.zoom)}%`);
  await page.context().close();
});

test("Space-drag pans without leaving the tool; keyboard + and - zoom in √2 steps", async ({ browser }) => {
  const page = await openDrawing(browser);
  const b = await box(page);
  await canvas(page).focus();
  const start = await view(page);

  await page.keyboard.down(" ");
  await expect(canvas(page)).toHaveCSS("cursor", "grab");
  await page.mouse.move(b.x + 400, b.y + 300);
  await page.mouse.down();
  await expect(canvas(page)).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(b.x + 300, b.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  const panned = await nextView(page, start);
  expect(panned.cx - start.cx).toBeCloseTo(100 / start.zoom, 1);
  expect(panned.cy - start.cy).toBeCloseTo(50 / start.zoom, 1);
  await expect(canvas(page)).toHaveCSS("cursor", "default"); // back to Select
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // + and - zoom about the cursor while it is over the canvas: move it away first.
  await page.mouse.move(b.x - 30, b.y - 30);
  await page.keyboard.press("+");
  const zoomIn = await nextView(page, panned);
  expect(zoomIn.zoom / panned.zoom).toBeCloseTo(SQRT2, 6);
  expect(zoomIn.cx).toBeCloseTo(panned.cx, 2); // about the viewport centre
  await page.keyboard.press("-");
  const zoomOut = await nextView(page, zoomIn);
  expect(zoomOut.zoom).toBeCloseTo(panned.zoom, 6);

  // Single keys do nothing while the focus is elsewhere.
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Zoom in" }).focus();
  await page.keyboard.press("-");
  await page.waitForTimeout(100);
  expect((await view(page)).zoom).toBeCloseTo(zoomOut.zoom, 6);
  await page.context().close();
});

test("Fit page and Fit width (keys, toolbar, View menu), rotate view, and no browser zoom on Ctrl+0", async ({ browser }) => {
  const page = await openDrawing(browser);
  const fitPage = await view(page);
  const dpr = await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1]);

  await canvas(page).focus();
  await page.keyboard.press("Control+0");
  const fitWidth = await nextView(page, fitPage);
  expect(fitWidth.zoom).toBeGreaterThan(fitPage.zoom * 1.1); // A3 landscape in a wide canvas
  expect(await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1])).toEqual(dpr);

  await page.keyboard.press("Control+9");
  const back = await nextView(page, fitWidth);
  expect(back.zoom).toBeCloseTo(fitPage.zoom, 6);

  const toolbar = page.getByRole("toolbar", { name: "Document" });
  await toolbar.getByRole("button", { name: "Fit width" }).click();
  expect((await nextView(page, back)).zoom).toBeCloseTo(fitWidth.zoom, 6);
  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: /Fit page/ }).click();
  const fitted = await nextView(page, fitWidth);
  expect(fitted.zoom).toBeCloseTo(fitPage.zoom, 6);

  await toolbar.getByRole("button", { name: "Rotate view clockwise" }).click();
  const rotated = await nextView(page, fitted);
  expect(rotated.rotation).toBe(90);
  expect(rotated.zoom).toBeLessThan(fitted.zoom); // the landscape sheet now stands upright, still fitted
  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Rotate view counter-clockwise" }).click();
  const unrotated = await nextView(page, rotated);
  expect(unrotated.rotation).toBe(0);
  expect(unrotated.zoom).toBeCloseTo(fitPage.zoom, 6);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await page.context().close();
});

test("Zoom tool: click zooms in, a drag zooms to the rectangle; Pan tool drags", async ({ browser }) => {
  const page = await openDrawing(browser);
  const b = await box(page);
  await canvas(page).focus();
  await page.keyboard.press("z");
  await expect(canvas(page)).toHaveCSS("cursor", "zoom-in");
  // Zoom's hint bar takes room from the canvas (the page refits): wait for it and the refit to settle.
  await expect(page.getByTestId("hint-bar")).toContainText("Zoom:");
  let start = await view(page);
  await expect.poll(async () => {
    const now = await view(page);
    const same = now.zoom === start.zoom;
    start = now;
    return same;
  }).toBe(true);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const clicked = await nextView(page, start);
  expect(clicked.zoom / start.zoom).toBeCloseTo(SQRT2, 6);

  await page.mouse.move(b.x + 100, b.y + 100);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 200, { steps: 4 });
  await page.mouse.up();
  const rect = await nextView(page, clicked);
  expect(rect.zoom).toBeGreaterThan(clicked.zoom * 3);

  await page.keyboard.press("Shift+V");
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Pan" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.mouse.move(b.x + 500, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 520, b.y + 330, { steps: 3 });
  await page.mouse.up();
  const panned = await nextView(page, rect);
  expect(panned.cx - rect.cx).toBeCloseTo(-20 / rect.zoom, 2);
  await page.keyboard.press("v");
  await expect(canvas(page)).toHaveCSS("cursor", "default");
  await page.context().close();
});
