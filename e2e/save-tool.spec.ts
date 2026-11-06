// Story 7.2: save a markup as a tool (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: a rectangle drawn on the fixture, selected, right-click → Add to
// Tool Chest…; the dialog suggests the name, makes a new set when there is
// none, takes a device's group and label; the tool's tile (preview and name)
// shows in the Tool Chest and is still there after a reload. An image tool:
// its pixels go to the private bucket and its preview comes back after a
// reload (fetched by its signed URL; the CSP keeps img-src to self/blob/data).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const chest = (page: Page) => page.getByRole("complementary", { name: "Tool Chest" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Add to Tool Chest" });

/** Shows the Tool Chest panel (its switcher radio toggles: click only when it is not shown). */
async function showChest(page: Page) {
  // The layout is restored after hydration: retry until the panel stays shown.
  await expect(async () => {
    const radio = page.getByRole("radio", { name: "Tool Chest" });
    if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
    await expect(chest(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
}

async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
}

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

async function press(page: Page, key: string) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press(key);
}

/** Red pixels drawn on a tile's preview canvas. */
function redPixels(page: Page, index = 0) {
  return chest(page)
    .getByTestId("tool-preview")
    .nth(index)
    .evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 60) red++;
      return red;
    });
}

async function snapTo(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
}

test("save a markup as a tool: Add to Tool Chest…, a new set, a device, the tile persists", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();
  await open(page);

  // A rectangle on the fixture's rectangle.
  await press(page, "r");
  await expect(page.getByText(/^Rectangle: drag from one corner/)).toBeVisible();
  await stable(page);
  await snapTo(page, 100, 100);
  await page.mouse.down();
  await snapTo(page, 300, 250);
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");

  // Select it; right-click on it → Add to Tool Chest….
  await press(page, "v");
  await stable(page);
  const inside = await screenOf(page, 150, 200);
  await page.mouse.click(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y, { button: "right" });
  await page.getByRole("menu", { name: "Markup" }).getByRole("menuitem", { name: /Add to Tool Chest/ }).click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Rectangle");
  await expect(dialog(page).getByRole("combobox", { name: "Tool set" })).toContainText("New tool set…");
  await dialog(page).getByRole("textbox", { name: "Name", exact: true }).fill("Riser zone");
  await dialog(page).getByRole("textbox", { name: "New set name" }).fill("Sprinkler");
  await dialog(page).getByRole("checkbox", { name: "Count as a device" }).click();
  await dialog(page).getByRole("textbox", { name: "Group" }).fill("Zones");
  await dialog(page).getByRole("textbox", { name: "Label" }).fill("Riser");
  await dialog(page).getByRole("button", { name: "Add tool" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Added “Riser zone” to Sprinkler.", { exact: true })).toBeVisible();

  const tile = chest(page).getByTestId("tool");
  await expect(chest(page).getByTestId("tool-set").locator("button[aria-expanded]")).toHaveText(["Sprinkler (1)"]);
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText("Riser zone");
  await expect(tile).toContainText("Riser");
  await expect(tile.getByTestId("tool-preview")).toBeVisible();
  // The preview draws the rectangle (red, the default markup colour; a thin, anti-aliased line) on white.
  await expect.poll(() => redPixels(page)).toBeGreaterThan(20);

  // Saved: after a reload the tile is back.
  await page.reload();
  await showChest(page);
  await expect(chest(page).getByTestId("tool")).toHaveCount(1, { timeout: 15_000 });
  await expect(chest(page).getByTestId("tool")).toContainText("Riser zone");
  await expect(chest(page).getByTestId("tool")).toHaveAttribute("title", "Riser zone (Zones: Riser)");
  await context.close();
});

test("an image tool keeps its pixels in the bucket and shows them after a reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
  await open(page);

  // A red 200 × 100 PNG, placed at (500, 300).
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, 200, 100);
    return c.toDataURL("image/png").split(",")[1];
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Image" }).click();
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.getByText(/^Image: click where the image goes/)).toBeVisible();
  await stable(page);
  const centre = await screenOf(page, 500, 300);
  await page.mouse.click(centre.x, centre.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "Image");

  await page.mouse.click(centre.x, centre.y);
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await page.getByRole("menu", { name: "Markup" }).getByRole("menuitem", { name: /Add to Tool Chest/ }).click();
  await expect(dialog(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Image");
  await dialog(page).getByRole("button", { name: "Add tool" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(chest(page).getByTestId("tool")).toHaveCount(1);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(200);

  await page.reload();
  await showChest(page);
  await expect(chest(page).getByTestId("tool")).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => redPixels(page), { timeout: 15_000 }).toBeGreaterThan(200);
  await context.close();
});
