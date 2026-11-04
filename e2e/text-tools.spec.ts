// Story 5.6: Text box, Callout, Cloud+, Typewriter and Note on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: T drags a text box and types two words (its letters arm no tool), Esc
// adds it; Q a callout ended by a click on the canvas; K a Cloud+ ended with
// Ctrl+Enter; Typewriter and Note from the rail menu; an empty note adds
// nothing; each is one undo step.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
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

async function clickCorner(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Focuses the canvas once a closed menu has given focus back to its trigger. */
async function focusCanvas(page: Page) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
}

async function press(page: Page, key: string) {
  await focusCanvas(page);
  await page.keyboard.press(key);
}

/** Arms a tool by its key; the HintBar names it (and may shift the canvas). */
async function arm(page: Page, key: string, hint: RegExp) {
  await press(page, key);
  await expect(page.getByText(hint)).toBeVisible();
  await stable(page);
}

async function snapTo(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  return at;
}

const field = (page: Page) => page.getByRole("textbox", { name: "Markup text" });

async function clickAt(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.click(at.x, at.y);
}

async function typeText(page: Page, text: string) {
  await expect(field(page)).toBeFocused();
  await page.keyboard.type(text);
}

async function fromRail(page: Page, tool: string, hint: RegExp) {
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "More text tools" }).click();
  await page.getByRole("menuitemradio", { name: tool }).click();
  await expect(page.getByText(hint)).toBeVisible();
  await stable(page);
}

test("text tools: T, Q, K, Typewriter and Note place a markup and its typed text; each one undo step; empty adds nothing", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // T: drag a box over the rectangle; the typed letters arm no tool; Esc adds it.
  await arm(page, "t", /^Text box: drag from one corner/);
  await snapTo(page, 100, 250);
  await page.mouse.down();
  await snapTo(page, 300, 100);
  await page.mouse.up();
  await typeText(page, "Revised layout");
  await page.keyboard.press("Escape");
  await expect(markups(page)).toHaveAttribute("data-captions", "Text box: Revised layout");
  await expect(field(page)).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Text box" })).toBeChecked();
  await expectUndo(page, "Undo Add text box");

  // Q: the tip, then where the text goes; a click on the canvas ends it (and places nothing).
  await arm(page, "q", /^Callout: click the point/);
  await clickCorner(page, 300, 250);
  await clickAt(page, 150, 450);
  await typeText(page, "See note");
  await clickAt(page, 200, 40);
  await expect(markups(page)).toHaveAttribute("data-captions", "Text box: Revised layout | Callout: See note");
  await expect(field(page)).toBeHidden();
  await expectUndo(page, "Undo Add callout");

  // K: the cloud closed on its first corner, then the text's click; Ctrl+Enter ends it.
  await arm(page, "k", /^Cloud\+: click each corner/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 300, 250);
  await clickCorner(page, 100, 100);
  await clickAt(page, 150, 40);
  await typeText(page, "Rev A");
  await page.keyboard.press("Control+Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", "Text box: Revised layout | Callout: See note | Cloud+: Rev A");
  await expectUndo(page, "Undo Add cloud+");

  // Typewriter and Note from the rail's menu.
  await fromRail(page, "Typewriter", /^Typewriter: click where/);
  await clickAt(page, 600, 60);
  await typeText(page, "Typed");
  await page.keyboard.press("Escape");
  await fromRail(page, "Note", /^Note: click where/);
  await clickAt(page, 700, 60);
  await typeText(page, "Check");
  await page.keyboard.press("Escape");
  const all = "Text box: Revised layout | Callout: See note | Cloud+: Rev A | Typewriter: Typed | Note: Check";
  await expect(markups(page)).toHaveAttribute("data-captions", all);
  await expectUndo(page, "Undo Add note");

  // An empty note adds nothing.
  await clickAt(page, 750, 60);
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field(page)).toBeHidden();
  await expect(markups(page)).toHaveAttribute("data-captions", all);

  // Each was one step.
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Text box: Revised layout | Callout: See note | Cloud+: Rev A | Typewriter: Typed");
  await context.close();
});
