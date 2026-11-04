// Story 5.13: the personal signature stamp on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape.
// Covers: Settings → Account & signature; a signature drawn on the pad is
// previewed and saved (private storage), read back when the dialog opens
// again; "Place on drawing" arms Image, a click places the stamp, one undo
// step "Add signature"; Delete removes the saved signature.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" });

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}

async function openAccount(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: "Account & signature…" }).click();
  const dialog = page.getByRole("dialog", { name: "Account & signature" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Loading…")).toBeHidden();
  return dialog;
}

test("signature: draw, save, read back, place as a stamp in one undo step, delete", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  let dialog = await openAccount(page);
  // A stroke on the pad: a preview, then Save.
  const pad = (await dialog.getByTestId("signature-pad").boundingBox())!;
  await page.mouse.move(pad.x + 40, pad.y + 100);
  await page.mouse.down();
  for (const [dx, dy] of [[90, 40], [140, 120], [200, 50], [260, 110], [320, 60]]) await page.mouse.move(pad.x + dx, pad.y + dy, { steps: 4 });
  await page.mouse.up();
  await expect(dialog.getByRole("img", { name: "New signature preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save signature" }).click();
  await expect(dialog.getByRole("img", { name: "Your saved signature" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "New signature preview" })).toBeHidden();
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();

  // Opened again, it is read back from storage (a signed URL).
  dialog = await openAccount(page);
  await expect(dialog.getByRole("img", { name: "Your saved signature" })).toBeVisible();
  await expect.poll(() => dialog.getByRole("img", { name: "Your saved signature" }).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // Place on drawing: Image is armed with the stamp; a click places it.
  await dialog.getByRole("button", { name: "Place on drawing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Image: click where the image goes/)).toBeVisible();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(markups(page)).toHaveAttribute("data-captions", /^Signature: .+/);
  await expect(rail(page).getByRole("radio", { name: "Select" })).toBeChecked();
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: "Undo Add signature" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);

  // Delete: no saved signature, here and when opened again.
  dialog = await openAccount(page);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByText(/^No signature yet/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  dialog = await openAccount(page);
  await expect(dialog.getByText(/^No signature yet/)).toBeVisible();
  await context.close();
});
