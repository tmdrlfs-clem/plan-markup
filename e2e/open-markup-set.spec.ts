// Story 6.6: opening a markup set (production build in CI).
//   scales.pdf (Story 4.2): 5 pages.
// Covers: a line saved on scales.pdf; in a new tab of the browser the empty
// workspace lists the set (5 pages); opening it asks for the PDF, and the same
// bytes open with the line restored. From File → Markup sets…, Blank pages
// shows the line on 5 blank pages named scales.pdf with a notice; other bytes
// keep the blank pages; the PDF itself replaces them (one tab, the line kept).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf"));
const CHANGED = Buffer.concat([PDF, Buffer.from("\n% revision B\n")]);

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markupsCanvas = (page: Page) => page.getByTestId("markups-canvas");
const hintBar = (page: Page) => page.getByTestId("hint-bar");
const tabs = (page: Page) => page.getByRole("tab");

async function choosePdf(page: Page, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: "Open scales.pdf" }).getByRole("button", { name: "Choose PDF…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer });
}

test("opening a markup set: the recent list and the set list ask for the PDF; blank pages without it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await expect(page.getByText("No recent drawings")).toBeVisible();

  // A line on scales.pdf, saved.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press("l");
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Line");
  await expect(page.getByTestId("status-bar").getByTestId("status-save")).toHaveText("Saved", { timeout: 10_000 });

  // A new tab of the browser: the empty workspace lists the set; the same bytes restore the line.
  const fresh = await context.newPage();
  await fresh.goto("/workspace");
  const recent = fresh.getByTestId("recent-drawing");
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText("scales.pdf");
  await expect(recent).toContainText("5 pages");
  await recent.click();
  await choosePdf(fresh, PDF);
  await expect(canvas(fresh)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(markupsCanvas(fresh)).toHaveAttribute("data-captions", "Line", { timeout: 10_000 });
  await expect(hintBar(fresh)).toHaveCount(0);

  // Another tab: File → Markup sets… → Open… → Blank pages.
  const blank = await context.newPage();
  await blank.goto("/workspace");
  await blank.getByRole("menubar").getByRole("menuitem", { name: "File" }).click();
  await blank.getByRole("menuitem", { name: "Markup sets…" }).click();
  await blank.getByRole("dialog", { name: "Markup sets" }).getByRole("button", { name: "Open scales.pdf" }).click();
  await blank.getByRole("dialog", { name: "Open scales.pdf" }).getByRole("button", { name: "Blank pages" }).click();
  await expect(canvas(blank)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(hintBar(blank)).toHaveText(/Markups on blank pages: scales\.pdf, 5 pages/, { timeout: 10_000 });
  await expect(hintBar(blank)).toHaveAttribute("data-variant", "info");
  await expect(markupsCanvas(blank)).toHaveAttribute("data-captions", "Line", { timeout: 10_000 });
  await expect(tabs(blank)).toHaveCount(1);
  await expect(tabs(blank)).toContainText("scales.pdf");

  // Other bytes keep the blank pages.
  await hintBar(blank).getByRole("button", { name: "Open the PDF…" }).click();
  await choosePdf(blank, CHANGED);
  // Radix announces a toast through a hidden live-region copy for a moment: two matches.
  await expect(blank.getByText(/is not the file these markups were made on/).first()).toBeVisible();
  await expect(hintBar(blank)).toHaveText(/Markups on blank pages/);
  await expect(tabs(blank)).toHaveCount(1);

  // The PDF itself replaces them: one tab, the line kept, no notice.
  await hintBar(blank).getByRole("button", { name: "Open the PDF…" }).click();
  await choosePdf(blank, PDF);
  await expect(hintBar(blank)).toHaveCount(0, { timeout: 20_000 });
  await expect(tabs(blank)).toHaveCount(1);
  await expect(canvas(blank)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(markupsCanvas(blank)).toHaveAttribute("data-captions", "Line");
  await context.close();
});
