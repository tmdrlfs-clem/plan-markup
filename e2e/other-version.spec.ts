// Story 6.5: markups on another version of the file (production build in CI).
//   scales.pdf (Story 4.2): 5 pages.
// Covers: a line saved on scales.pdf; the same filename with other bytes opens
// with no markups and the HintBar "Markups exist on another version of this
// file" (info, never wording of loss); "Open markup set list" lists the set
// (filename, 5 pages, 1 markup); Dismiss hides the notice for that document.
// The set list is also on File → Markup sets…
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf"));
const CHANGED = Buffer.concat([PDF, Buffer.from("\n% revision B\n")]);

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markupsCanvas = (page: Page) => page.getByTestId("markups-canvas");
const hintBar = (page: Page) => page.getByTestId("hint-bar");

async function openFile(page: Page, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}

test("another version: same filename, other bytes → an info notice that opens the set list; nothing moved; dismissible", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");

  // A line on scales.pdf, saved.
  await openFile(page, PDF);
  await expect(hintBar(page)).toHaveCount(0);
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

  // The same name, other bytes (a new tab of the browser: no session for it).
  const other = await context.newPage();
  await other.goto("/workspace");
  await openFile(other, CHANGED);
  await expect(hintBar(other)).toHaveText(/Markups exist on another version of this file/, { timeout: 10_000 });
  await expect(hintBar(other)).toHaveAttribute("data-variant", "info");
  await expect(markupsCanvas(other)).not.toHaveAttribute("data-captions", /.+/);

  // Its action lists the set.
  await hintBar(other).getByRole("button", { name: "Open markup set list" }).click();
  const list = other.getByRole("dialog", { name: "Markup sets" });
  await expect(list.getByTestId("markup-set-row")).toHaveCount(1);
  await expect(list.getByTestId("markup-set-row")).toContainText("scales.pdf");
  await expect(list.getByTestId("markup-set-row").locator("td").nth(1)).toHaveText("5");
  await expect(list.getByTestId("markup-set-row").locator("td").nth(2)).toHaveText("1");
  await list.getByRole("button", { name: "Done" }).click();

  // Dismiss hides it for this document.
  await hintBar(other).getByRole("button", { name: "Dismiss" }).click();
  await expect(hintBar(other)).toHaveCount(0);

  // File → Markup sets… opens the same list.
  await other.getByRole("menubar").getByRole("menuitem", { name: "File" }).click();
  await other.getByRole("menuitem", { name: "Markup sets…" }).click();
  await expect(other.getByRole("dialog", { name: "Markup sets" }).getByTestId("markup-set-row")).toHaveCount(1);
  await context.close();
});
