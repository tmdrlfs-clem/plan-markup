// Story 7.8: the auto legend on the committed fixture fixtures/pdf/snap.pdf.
// Covers: a rectangle saved as a device tool (Zones · Riser) and placed twice;
// the rail's Legend places a legend by a click (one undo step, then Select has
// it) listing the page's devices with their counts; Properties renames it;
// another placement and an undo update its count live; it survives a reload.
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

async function snapTo(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

const legendCaption = async (page: Page) => ((await markups(page).getAttribute("data-captions")) ?? "").split(" | ").filter((c) => c.includes(" — ")).join(" | ");

test("auto legend: lists the page's devices with counts, follows them live, kept after a reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
  await open(page);

  // A rectangle saved as a device tool, placed twice.
  await press(page, "r");
  await stable(page);
  await snapTo(page, 100, 100);
  await page.mouse.down();
  await snapTo(page, 300, 250);
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");
  await press(page, "v");
  await stable(page);
  const inside = await screenOf(page, 150, 200);
  await page.mouse.click(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y, { button: "right" });
  await page.getByRole("menu", { name: "Markup" }).getByRole("menuitem", { name: /Add to Tool Chest/ }).click();
  await dialog(page).getByRole("textbox", { name: "Name", exact: true }).fill("Zone");
  await dialog(page).getByRole("checkbox", { name: "Count as a device" }).click();
  await dialog(page).getByRole("textbox", { name: "Group" }).fill("Zones");
  await dialog(page).getByRole("textbox", { name: "Label" }).fill("Riser");
  await dialog(page).getByRole("button", { name: "Add tool" }).click();
  await expect(dialog(page)).toBeHidden();
  const tile = chest(page).getByRole("button", { name: "Zone (Zones: Riser)" });
  await tile.click();
  await stable(page);
  for (const [x, y] of [[450, 200], [550, 200]] as const) {
    const at = await screenOf(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  await expect(page.getByTestId("markups-list-row")).toHaveCount(3);
  await press(page, "Escape");

  // The rail's Legend: a click places it, listing the page's devices.
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Legend" }).click();
  await expect(page.getByText(/^Legend: click where it goes/)).toBeVisible();
  await stable(page);
  const at = await screenOf(page, 650, 420);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => legendCaption(page)).toBe("LEGEND — 2 devices");
  await expectUndo(page, "Undo Add legend");

  // Select has it: Properties renames it.
  await press(page, "Alt+p");
  const panel = page.getByTestId("properties-panel");
  await expect(panel.getByLabel("Title")).toHaveValue("LEGEND");
  await panel.getByLabel("Title").fill("DEVICES");
  await panel.getByLabel("Title").press("Enter");
  await expect.poll(() => legendCaption(page)).toBe("DEVICES — 2 devices");
  await expectUndo(page, "Undo Edit legend");

  // Another placement counts at once; its undo takes it off again.
  await press(page, "s");
  await stable(page);
  const third = await screenOf(page, 450, 300);
  await page.mouse.click(third.x, third.y);
  await expect.poll(() => legendCaption(page)).toBe("DEVICES — 3 devices");
  await press(page, "Escape");
  await press(page, "Control+z");
  await expect.poll(() => legendCaption(page)).toBe("DEVICES — 2 devices");

  await page.reload();
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await expect.poll(() => legendCaption(page), { timeout: 15_000 }).toBe("DEVICES — 2 devices");
  await context.close();
});
