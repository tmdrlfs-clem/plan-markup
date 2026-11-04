// Story 5.8: Image and Dimension on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: the rail's Image picks a PNG (200 × 100 px, red), a click places it
// centred at 150 × 75 pt and Select has it; its corner handle with Shift
// doubles it; a Dimension along the rectangle's bottom edge reads "Scale not
// set" on the uncalibrated page; each one undo step.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
/** The resize handles sit 8 CSS px outside the box. */
const HANDLE_GAP = 8;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" });

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

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** The markups canvas's pixel (r, g, b, a) under user space point (x, y). */
async function pixel(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  const box = (await markups(page).boundingBox())!;
  return markups(page).evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data).join(",");
    },
    { x: at.x - box.x, y: at.y - box.y },
  );
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

test("image and dimension: pick, place, resize an image; a dimension reads Scale not set; each one undo step", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // A red 200 × 100 PNG, made by the browser.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, 200, 100);
    return c.toDataURL("image/png").split(",")[1];
  });

  // Image: the rail button asks for the file, then a click places it centred.
  const chooser = page.waitForEvent("filechooser");
  await rail(page).getByRole("radio", { name: "Image" }).click();
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.getByText(/^Image: click where the image goes/)).toBeVisible();
  await stable(page);
  const centre = await screenOf(page, 500, 300);
  await page.mouse.click(centre.x, centre.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "Image");
  await expectUndo(page, "Undo Add image");
  await expect(rail(page).getByRole("radio", { name: "Select" })).toBeChecked();
  // 150 × 75 pt: red inside, nothing past its right edge.
  await expect.poll(() => pixel(page, 560, 320)).toBe("255,0,0,255");
  expect(await pixel(page, 600, 320)).toBe("0,0,0,0");

  // Its top right handle with Shift to twice the size (from the bottom left corner).
  await stable(page);
  const corner = await screenOf(page, 575, 337.5);
  const far = await screenOf(page, 725, 412.5);
  await page.mouse.move(corner.x + HANDLE_GAP, corner.y - HANDLE_GAP);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(far.x + HANDLE_GAP, far.y - HANDLE_GAP, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectUndo(page, "Undo Resize markup");
  await expect.poll(() => pixel(page, 700, 400)).toBe("255,0,0,255");

  // Dimension from the line tools' menu: the rectangle's bottom edge, its line below it.
  await rail(page).getByRole("button", { name: "More line tools" }).click();
  await page.getByRole("menuitemradio", { name: "Dimension" }).click();
  await expect(page.getByText(/^Dimension: click the two points/)).toBeVisible();
  await stable(page);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  const below = await screenOf(page, 200, 60);
  await page.mouse.move(below.x, below.y);
  await page.keyboard.down("Alt");
  await page.mouse.click(below.x, below.y);
  await page.keyboard.up("Alt");
  await expect(markups(page)).toHaveAttribute("data-captions", "Image | Dimension: Scale not set");
  await expectUndo(page, "Undo Add dimension");

  // Each was one step.
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Image");
  await context.close();
});
