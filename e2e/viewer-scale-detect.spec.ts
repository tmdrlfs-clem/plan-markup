// Story 4.2: printed scales on the committed fixture fixtures/pdf/scales.pdf
// (scripts/fixtures/make-scales-fixture.mjs): the four status-bar texts.
//   page 1 (A1): "SCALE 1:100 @ A1"                      -> Scale 1:100 @ A1 detected — Verify
//   page 2 (A3): the same text                           -> Scale 1:200 (1:100 @ A1) detected — Verify
//   page 3 (A1): viewports 1:50 and 1:100 (twice)        -> 2 scales on page
//   page 4 (A3): "As indicated", a slope, a date, a flood return period -> Scale not set
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");

test("printed scales: detected on its sheet, converted on another, several on one page, none from look-alikes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");

  await expect(scale(page)).toHaveText("Scale 1:100 @ A1 detected — Verify", { timeout: 20_000 });
  await expect(scale(page)).toHaveAttribute("data-tone", "warning");
  await expect(scale(page).locator("svg.lucide-triangle-alert")).toHaveCount(1);

  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(scale(page)).toHaveText("Scale 1:200 (1:100 @ A1) detected — Verify", { timeout: 20_000 });
  await scale(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("1:100 @ A1 → 1:200 on this A3 page");

  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(scale(page)).toHaveText("2 scales on page", { timeout: 20_000 });
  await scale(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("1:100; 1:50");

  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(canvas(page)).toHaveAttribute("aria-label", /page 4 of 4/);
  // Give detection time to answer, then: still not set.
  await page.waitForTimeout(1500);
  await expect(scale(page)).toHaveText("Scale not set");
  await context.close();
});
