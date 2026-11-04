// Story 5.7: Pen and Highlight on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: P drags a freehand stroke; a click adds nothing; H with Shift held
// draws a straight highlight (horizontal on screen) on the multiply layer at
// 40 %; each stroke is one undo step.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const highlights = (page: Page) => page.getByTestId("highlights-canvas");

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
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

async function arm(page: Page, key: string, hint: RegExp) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press(key);
  await expect(page.getByText(hint)).toBeVisible();
  await stable(page);
}

/** Presses at the first user space point, moves through the others in small steps, releases at the last. */
async function stroke(page: Page, points: [number, number][]) {
  const at = await Promise.all(points.map(([x, y]) => screenOf(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** The highlights canvas's alpha (0–255) under user space point (x, y). */
async function highlightAlpha(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  const box = (await highlights(page).boundingBox())!;
  return highlights(page).evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      return c.getContext("2d")!.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data[3];
    },
    { x: at.x - box.x, y: at.y - box.y },
  );
}

test("ink tools: P draws a freehand stroke, H with Shift a straight highlight multiplied at 40 %; each one undo step", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // P: a freehand stroke; the tool stays armed.
  await arm(page, "p", /^Pen: drag to draw freehand/);
  await stroke(page, [
    [400, 400],
    [450, 430],
    [500, 400],
    [550, 440],
  ]);
  await expect(markups(page)).toHaveAttribute("data-captions", "Pen");
  await expectUndo(page, "Undo Add pen");
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Pen" })).toBeChecked();

  // A click draws nothing.
  const click = await screenOf(page, 600, 450);
  await page.mouse.click(click.x, click.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "Pen");

  // H with Shift: held horizontal from its start.
  await arm(page, "h", /^Highlight: drag over the sheet/);
  await page.keyboard.down("Shift");
  await stroke(page, [
    [400, 300],
    [470, 340],
    [560, 330],
  ]);
  await page.keyboard.up("Shift");
  await expect(markups(page)).toHaveAttribute("data-captions", "Pen | Highlight");
  await expectUndo(page, "Undo Add highlight");
  await expect(highlights(page)).toHaveCSS("mix-blend-mode", "multiply");
  // On the held line at 40 % (102 of 255), none where the pointer went.
  await expect.poll(() => highlightAlpha(page, 540, 300)).toBeGreaterThan(90);
  expect(await highlightAlpha(page, 540, 300)).toBeLessThan(115);
  expect(await highlightAlpha(page, 540, 340)).toBe(0);

  // Each was one step.
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Pen");
  await expect.poll(() => highlightAlpha(page, 540, 300)).toBe(0);
  await context.close();
});
