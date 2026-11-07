// Story 7.7: the revision stamp on the committed fixture fixtures/pdf/snap.pdf.
// Covers: the rail's Revision stamp, a click places "Rev A — As-built" by the
// signed-in user with today's date (one undo step, then Select has it);
// Properties edits its revision and description at once, refuses an invalid
// date with why; it survives a reload; the next stamp is the revision after
// the latest (D).
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

async function press(page: Page, key: string) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press(key);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("revision stamp: placed by a click, edited in Properties, numbered on, kept after a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Revision stamp" }).click();
  await expect(page.getByText(/^Revision stamp: click where it goes/)).toBeVisible();
  await stable(page);
  const at = await screenOf(page, 600, 120);
  await page.mouse.click(at.x, at.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "Revision A — As-built");
  await expectUndo(page, "Undo Add revision stamp");

  // Select has it: Properties shows its fields.
  await press(page, "Alt+p");
  const panel = page.getByTestId("properties-panel");
  await expect(panel.getByLabel("Revision")).toHaveValue("A");
  await expect(panel.getByLabel("Date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(panel.getByLabel("Author")).not.toHaveValue("");
  await panel.getByLabel("Revision").fill("C");
  await panel.getByLabel("Revision").press("Enter");
  await panel.getByLabel("Description").fill("As-built — level 2");
  await panel.getByLabel("Description").press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", "Revision C — As-built — level 2");
  await expectUndo(page, "Undo Edit revision stamp");
  // An invalid date is refused with why; the stamp keeps its own.
  await panel.getByLabel("Date").fill("7/11/2026");
  await panel.getByLabel("Date").press("Enter");
  await expect(page.getByText("Enter a date as YYYY-MM-DD.", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  // The next stamp is the revision after the latest.
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Revision stamp" }).click();
  await stable(page);
  const next = await screenOf(page, 600, 300);
  await page.mouse.click(next.x, next.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "Revision C — As-built — level 2 | Revision D — As-built");

  await page.reload();
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await expect(markups(page)).toHaveAttribute("data-captions", "Revision C — As-built — level 2 | Revision D — As-built", { timeout: 15_000 });
});
