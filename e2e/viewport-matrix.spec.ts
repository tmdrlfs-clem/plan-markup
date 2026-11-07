// Story 8.5 (UX-DR37, UX-DR39): the workspace smoke on the viewport matrix
// 1280×720, 1440×900, 1920×1080 and 2560×1440 at 2× on the committed fixture
// fixtures/pdf/snap.pdf. Each: the chrome fits (no page scroll either way, the
// menu bar, toolbar, rail and status bar on screen), the drawing renders at the
// device pixel ratio, Length measures, and axe-core finds no serious or
// critical violation on the workspace chrome.
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");

const MATRIX = [
  { width: 1280, height: 720, scale: 1 },
  { width: 1440, height: 900, scale: 1 },
  { width: 1920, height: 1080, scale: 1 },
  { width: 2560, height: 1440, scale: 2 },
] as const;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function inView(page: Page, name: string, box: { x: number; y: number; width: number; height: number } | null, viewport: { width: number; height: number }) {
  expect(box, `${name} is shown`).not.toBeNull();
  expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(viewport.height + 0.5);
}

for (const v of MATRIX) {
  test(`viewport ${v.width}×${v.height}@${v.scale}x: chrome fits, the drawing renders, Length measures, axe clean`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await signIn(page, "admin@plan-markup.test");
    await expect(page).toHaveURL("/workspace");

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
    await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
    await expect(canvas(page)).toHaveAttribute("data-state", "ready");

    // No page scroll; the chrome is on screen.
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
    expect(overflow).toEqual({ x: 0, y: 0 });
    await inView(page, "menu bar", await page.getByRole("menubar").boundingBox(), v);
    await inView(page, "document toolbar", await page.getByRole("toolbar", { name: "Document" }).boundingBox(), v);
    await inView(page, "tool rail", await page.getByRole("toolbar", { name: "Drawing tools" }).boundingBox(), v);
    await inView(page, "status bar", await page.getByTestId("status-bar").boundingBox(), v);
    const box = (await canvas(page).boundingBox())!;
    await inView(page, "canvas", box, v);
    expect(box.width, "the canvas keeps room").toBeGreaterThanOrEqual(600);

    // The drawing is drawn at the device pixel ratio (HiDPI).
    const backing = await canvas(page).evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width);
    expect(backing).toBeCloseTo(v.scale, 1);

    // Length measures (two clicks on the page).
    await page.keyboard.press("Shift+Alt+L");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx - 80, cy);
    await page.mouse.click(cx + 80, cy);
    await expect(page.getByTestId("markups-canvas")).toHaveAttribute("data-markup-count", "1");
    await page.keyboard.press("Escape");

    const results = await new AxeBuilder({ page }).include("[data-testid='workspace-root']").analyze();
    const serious = results.violations
      .filter((x) => x.impact === "serious" || x.impact === "critical")
      .map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(serious).toEqual([]);
    await context.close();
  });
}
