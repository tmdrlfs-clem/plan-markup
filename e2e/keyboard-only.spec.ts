// Story 8.5 (UX-DR39): the J1 core loop with the keyboard only, on the committed
// fixture fixtures/pdf/scales.pdf (page 1 "SCALE 1:100 @ A1"). Covers: Ctrl+O
// opens the drawing; Tab reaches the canvas; Shift+Alt+L arms Length and the
// scale prompt's "Use it" (reached by Tab) calibrates; the arrows move the
// keyboard pointer and Enter places the length's two points; the tool rail
// (Tab, then arrows) arms the Revision stamp and Enter places it; Ctrl+Shift+M
// then Tab to Flatten and Enter export. Settings → Keyboard shortcuts lists the set.
// axe-core finds no serious or critical violation on the workspace chrome.
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");

const focused = (target: Locator) => target.evaluate((el) => el === document.activeElement);

/** Presses Tab (Shift+Tab with `back`) until `target` has focus. */
async function tabTo(page: Page, target: Locator, back = false, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await focused(target)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  expect(await focused(target), "reached by Tab").toBe(true);
}

async function arrows(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("[data-testid='workspace-root']").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("keyboard only: open, calibrate, measure, stamp, flatten and export; axe clean", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  expect(await seriousViolations(page)).toEqual([]);

  // Open (Ctrl+O; the file picker is the system's).
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("status-scale")).toHaveAttribute("data-detection", "done", { timeout: 20_000 });

  // Calibrate: Length on an uncalibrated page prompts; "Use it" by Tab and Enter.
  await tabTo(page, canvas(page));
  await page.keyboard.press("Shift+Alt+L");
  const useIt = page.getByRole("region", { name: "Scale not set" }).getByRole("button", { name: "Use it" });
  await expect(useIt).toBeVisible();
  await tabTo(page, useIt);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("status-scale")).toHaveText("Scale 1:100");

  // Measure: the keyboard pointer places the length's two points.
  await tabTo(page, canvas(page), true);
  await arrows(page, "Shift+ArrowLeft", 3);
  await page.keyboard.press("Enter");
  await arrows(page, "Shift+ArrowRight", 6);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", /\d/);
  const length = await markups(page).getAttribute("data-captions");

  // Stamp: the rail's Revision stamp (Tab to the rail, arrows to the tool), placed with Enter.
  await page.keyboard.press("Escape");
  const rail = page.getByRole("toolbar", { name: "Drawing tools" });
  const revision = rail.getByRole("radio", { name: "Revision stamp" });
  await tabTo(page, rail.getByRole("radio", { checked: true }));
  for (let i = 0; i < 40 && !(await focused(revision)); i++) await page.keyboard.press("ArrowDown");
  await expect(revision).toBeFocused();
  await page.keyboard.press("Space");
  await expect(revision).toBeChecked();
  await tabTo(page, canvas(page));
  await arrows(page, "Shift+ArrowDown", 4);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", new RegExp(`^${length!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| Revision A — As-built$`));

  // Flatten: Ctrl+Shift+M, then the dialog's Flatten (2026-11-21: into the open drawing).
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+M");
  const flatten = page.getByRole("dialog", { name: "Flatten markups into the drawing?" });
  await expect(flatten).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await tabTo(page, flatten.getByRole("button", { name: "Flatten", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tablist", { name: "Open drawings" }).getByRole("tab", { name: "scales (flattened).pdf" })).toBeVisible();

  // Export: Save as… (Ctrl+Shift+S), Enter on Export.
  await expect(page.getByTestId("drawing-canvas")).toHaveAttribute("data-state", "ready");
  await page.keyboard.press("Control+Shift+S");
  const exportDialog = page.getByRole("dialog", { name: "Export editable PDF" });
  await expect(exportDialog).toBeVisible();
  const download = page.waitForEvent("download");
  await tabTo(page, exportDialog.getByRole("button", { name: "Export", exact: true }));
  await page.keyboard.press("Enter");
  const file = await download;
  expect(file.suggestedFilename()).toBe("scales (flattened).pdf");
  expect((await PDFDocument.load(readFileSync(await file.path()))).getPageCount()).toBe(5);

  // Settings → Keyboard shortcuts lists the set (view-only).
  await page.keyboard.press("Escape");
  const settings = page.getByRole("menubar").getByRole("menuitem", { name: "Settings" });
  await tabTo(page, page.getByRole("menubar").getByRole("menuitem").first(), true);
  for (let i = 0; i < 10 && !(await focused(settings)); i++) await page.keyboard.press("ArrowRight");
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  // The menu opens on its first item (Account & signature…); the next one is Keyboard shortcuts….
  await expect(page.getByRole("menuitem", { name: "Account & signature…" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Keyboard shortcuts…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts.getByRole("row").filter({ hasText: /^LengthShift\+Alt\+L$/ })).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();
  expect(await seriousViolations(page)).toEqual([]);
});
