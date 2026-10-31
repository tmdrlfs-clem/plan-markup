// Story 4.7: the scale prompt on the committed fixture fixtures/pdf/scales.pdf
// (Story 4.2: page 1 "SCALE 1:100 @ A1", page 2 the same on A3, page 3 two
// viewports, page 4 nothing, page 5 readings that disagree).
// Covers: Length on page 1 prompts "Detected 1:100 @ A1" → Use it calibrates
// (a length then reads a number) and its undo brings the prompt back; page 4
// offers only Calibrate…, which opens the dialog (cancelled, the prompt stays
// away on that page: founder decision); page 5 offers only Calibrate…;
// dismissing on page 5 keeps the prompt away there and a length there reads
// "Scale not set".
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const prompt = (page: Page) => page.getByRole("region", { name: "Scale not set" });
const detected = (page: Page) => expect(scale(page)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });

async function goTo(page: Page, n: number, key: "PageDown" | "PageUp") {
  await canvas(page).focus();
  await page.keyboard.press(key);
  await expect(canvas(page)).toHaveAttribute("aria-label", new RegExp(`page ${n} of 5`));
  await detected(page);
}

/** Two clicks with Alt (no snapping) around the canvas centre: a length of 200 CSS px. */
async function length(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  const y = box.y + box.height * 0.6;
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width / 2 - 100, y);
  await page.mouse.click(box.x + box.width / 2 + 100, y);
  await page.keyboard.up("Alt");
}

test("scale prompt: Use it, only Calibrate…, dismiss per page, never an unscaled number", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await detected(page);

  // Select: no prompt. Length (Revu's shortcut) on page 1: the detected scale, Use it; the canvas keeps the focus.
  await expect(prompt(page)).toBeHidden();
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+L");
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page)).toContainText("Detected 1:100 @ A1");
  await expect(prompt(page)).toContainText("Measurements show “Scale not set” until the page has a scale.");
  await expect(canvas(page)).toBeFocused();
  await prompt(page).getByRole("button", { name: "Use it" }).click();
  await expect(prompt(page)).toBeHidden();
  await expect(scale(page)).toHaveText(/^Scale 1:100/);
  await length(page);
  await expect(markups(page)).toHaveAttribute("data-captions", /^\d+ mm$/);

  // Undo the length, then the calibration: the page has no scale again and the prompt is back.
  await page.keyboard.press("Control+z");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await page.keyboard.press("Control+z");
  await expect(scale(page)).toHaveText("Scale 1:100 @ A1 detected — Verify");
  await expect(prompt(page)).toBeVisible();

  // Page 2: the same text on A3, converted.
  await goTo(page, 2, "PageDown");
  await expect(prompt(page)).toContainText("Detected 1:200 (1:100 @ A1)");
  await expect(prompt(page).getByRole("button", { name: "Use it" })).toBeVisible();

  // Page 4: nothing detected, only Calibrate…, which opens the dialog; cancelled, the prompt stays away on page 4.
  await goTo(page, 3, "PageDown");
  await expect(prompt(page)).toContainText("2 scales on page");
  await goTo(page, 4, "PageDown");
  await expect(prompt(page)).toContainText("No scale found on this page");
  await expect(prompt(page).getByRole("button", { name: "Use it" })).toHaveCount(0);
  await prompt(page).getByRole("button", { name: "Calibrate…" }).click();
  const dialog = page.getByRole("dialog", { name: "Calibrate" });
  await expect(dialog).toBeVisible();
  await expect(prompt(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toBeHidden();

  // Page 5: printed scales disagree, only Calibrate….
  await goTo(page, 5, "PageDown");
  await expect(prompt(page)).toContainText("Printed scales disagree");
  await expect(prompt(page).getByRole("button", { name: "Use it" })).toHaveCount(0);

  // Dismissed on page 5: gone there for the session, and a length there reads "Scale not set".
  await prompt(page).getByRole("button", { name: "Measure without scale" }).click();
  await expect(prompt(page)).toBeHidden();
  await length(page);
  await expect(markups(page)).toHaveAttribute("data-captions", "Scale not set");
  await goTo(page, 4, "PageUp");
  await expect(prompt(page)).toBeHidden();
  await goTo(page, 3, "PageUp");
  await expect(prompt(page)).toBeVisible();
  await goTo(page, 4, "PageDown");
  await expect(prompt(page)).toBeHidden();
  await goTo(page, 5, "PageDown");
  await expect(prompt(page)).toBeHidden();
  // Another tool: no prompt anywhere.
  await goTo(page, 4, "PageUp");
  await goTo(page, 3, "PageUp");
  await expect(prompt(page)).toBeVisible();
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true }).click();
  await expect(prompt(page)).toBeHidden();
  await context.close();
});
