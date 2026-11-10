// Story 9.13 (UX-DR39, J6): the 4541 loop with the keyboard only, on the committed fixture.
//   snap.pdf (Story 4.1): page 1 A4 landscape.
// Open (Ctrl+O), the 4541 panel (Alt+4) and its Calibrate button, 1:100 typed into the
// dialog; Polygon zone from the panel, its four corners placed with the keyboard pointer
// (arrows, Enter), Enter again adds the zone; the zone's use chosen in its list (type-ahead);
// Place heads; the zone's report read from the panel (figures, no rule breaks, its status).
// No mouse event is sent. axe-core finds no serious or critical violation with the report open.
// (The NFR6 timings are measured in perf-4541.spec.ts.)
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByTestId("sprinkler-panel");

const focused = (target: Locator) => target.evaluate((el) => el === document.activeElement);

/** Presses Tab (Shift+Tab with `back`) until `target` has focus. */
async function tabTo(page: Page, target: Locator, back = false, max = 120) {
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

test("keyboard only: zone, use, Place heads, read the report; axe clean", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  expect(await seriousViolations(page)).toEqual([]);

  // Open (Ctrl+O; the file picker is the system's).
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");

  // The 4541 panel asks for a scale first; its Calibrate button, then 1:100 typed and applied.
  await tabTo(page, canvas(page));
  await page.keyboard.press("Alt+4");
  const first = page.getByTestId("sprinkler-calibrate-first").getByRole("button", { name: "Calibrate" });
  await expect(first).toBeVisible();
  await tabTo(page, first);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Calibrate" });
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByTestId("calibrate-ratio"));
  await page.keyboard.type("1:100");
  await tabTo(page, dialog.getByRole("button", { name: "Apply" }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("status-scale")).toHaveText("Scale 1:100");

  // Zone: Polygon zone from the panel, four corners with the keyboard pointer, Enter again adds it.
  const polygon = panel(page).getByRole("button", { name: "Polygon zone" });
  await tabTo(page, polygon);
  await page.keyboard.press("Enter");
  await expect(polygon).toHaveAttribute("aria-pressed", "true");
  await tabTo(page, canvas(page), true);
  await arrows(page, "Shift+ArrowLeft", 4);
  await arrows(page, "Shift+ArrowUp", 3);
  await page.keyboard.press("Enter");
  await arrows(page, "Shift+ArrowRight", 8);
  await page.keyboard.press("Enter");
  await arrows(page, "Shift+ArrowDown", 6);
  await page.keyboard.press("Enter");
  await arrows(page, "Shift+ArrowLeft", 8);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const row = panel(page).getByTestId("zone-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("hazard-chip")).toHaveText("ELH");

  // Use: the zone's list, by type-ahead.
  const use = row.getByRole("combobox", { name: "Use of Zone 1" });
  await tabTo(page, use);
  await page.keyboard.press("Enter");
  const storage = page.getByRole("option", { name: "Storage (OH2)" });
  await expect(storage).toBeVisible();
  await page.keyboard.type("Stor");
  await expect(storage).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row.getByTestId("hazard-chip")).toHaveText("OH2");

  // Place heads.
  const place = panel(page).getByTestId("place-heads");
  await tabTo(page, place, true);
  await page.keyboard.press("Enter");
  await expect(panel(page).getByTestId("place-status")).toHaveText(/^\d+ heads? placed in 1 zone\.$/);
  await expect(panel(page).getByTestId("zone-check")).toHaveAttribute("data-tone", "pass");

  // Read the report: the zone's row, then its figures and that no rule breaks.
  await tabTo(page, row.getByRole("button", { name: /Zone 1/ }));
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("data-selected", "true");
  const report = panel(page).getByTestId("zone-report");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("report-hazard")).toContainText("OH2");
  await expect(report.getByTestId("report-ruleset")).toContainText("nzs4541 v1");
  await expect(report.getByTestId("report-heads")).toContainText(/\d/);
  await expect(report.getByTestId("report-maxSpacing")).toContainText("max 4 m");
  await expect(report.getByTestId("report-pass")).toBeVisible();
  await expect(panel(page).getByTestId("advisory-notice")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
