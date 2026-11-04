// Story 5.9: Underline and Strikethrough of PDF text, on the committed fixture
// fixtures/pdf/search.pdf (page 1: "ROOM 101 MEETING" at (60, 480), 12 pt
// Helvetica, "CH +2700" at (300, 440); page 2 is image-only).
// Covers: Underline from the rail drags across "ROOM" to "101" (whole words),
// Strikethrough from the slot's menu across "CH +2700"; each one undo step; on
// the image-only page the slot is disabled and its tooltip says why.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "search.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" });

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "search.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

/** Screen position of user space point (x, y) on the unrotated A4 page (box at the origin, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
}

/** Waits until the canvas stops moving or resizing (panels and the HintBar shift it) and its view is stable. */
async function stable(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = `${JSON.stringify(await canvas(page).boundingBox())} ${await canvas(page).getAttribute("data-view")}`;
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100, 100, 200, 200, 400] })
    .toBe(true);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Presses at user space (x0, y), drags to (x1, y), releases there. */
async function dragAcross(page: Page, x0: number, x1: number, y: number) {
  const a = await screenOf(page, x0, y);
  const b = await screenOf(page, x1, y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test("text markup: underline and strike through PDF words, one undo step each; off on an image-only page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Underline: from inside "ROOM" to inside "101", 4 pt above the baseline.
  await rail(page).getByRole("radio", { name: "Underline" }).click();
  await expect(page.getByText(/^Underline: Drag across the words/)).toBeVisible();
  await stable(page);
  await expect(canvas(page)).toHaveCSS("cursor", "text");
  // The page's text was asked for when the tool was armed (a drag in progress picks it up when it arrives).
  await dragAcross(page, 65, 110, 484);
  await expect(markups(page)).toHaveAttribute("data-captions", "Underline: ROOM 101");
  await expectUndo(page, "Undo Add underline");

  // Strikethrough from the slot's menu, across "CH +2700".
  await rail(page).getByRole("button", { name: "More text markup tools" }).click();
  await page.getByRole("menuitemradio", { name: "Strikethrough" }).click();
  await expect(page.getByText(/^Strikethrough: Drag across the words/)).toBeVisible();
  await stable(page);
  await dragAcross(page, 302, 340, 444);
  await expect(markups(page)).toHaveAttribute("data-captions", "Underline: ROOM 101 | Strikethrough: CH +2700");
  await expectUndo(page, "Undo Add strikethrough");

  // Each was one step.
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Underline: ROOM 101");

  // Page 2 is a scan: the slot is off, and says why.
  await page.keyboard.press("PageDown");
  await expect(canvas(page)).toHaveAttribute("data-state", "image-only");
  const slot = rail(page).getByRole("radio", { name: "Strikethrough" });
  await expect(slot).toHaveAttribute("aria-disabled", "true");
  await slot.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "This page is an image: it has no text to mark" }).first()).toBeVisible();
  await context.close();
});
