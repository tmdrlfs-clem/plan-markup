// Stories 8.1 / 8.2: File → Export → Editable PDF, and Flatten, on the committed fixture fixtures/pdf/snap.pdf.
// Covers: a length, a rectangle and a white-out drawn; the ExportDialog (all
// pages, the count it writes); the download is the drawing's own name and
// holds the length (its caption as /Contents) and the rectangle as native
// annotations, the white-out burned into page 1 (no annotation left); a toast
// says it was exported; the markup set is unchanged.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "@cantoo/pdf-lib";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");

/** Shows the Tool Chest panel (its switcher radio toggles: click only when it is not shown). */
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

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenOf(page, ...from);
  const b = await screenOf(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

const text = (d: PDFDict, key: string) => (d.lookup(PDFName.of(key)) as PDFString | PDFHexString | undefined)?.decodeText();

test("export an editable PDF: native annotations, the caption as shown, white-out burned in", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  await press(page, "Shift+Alt+L");
  await stable(page);
  for (const [x, y] of [[500, 150], [700, 150]] as const) {
    const at = await screenOf(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  await press(page, "r");
  await stable(page);
  await drag(page, [500, 300], [650, 400]);
  await press(page, "Shift+W");
  await stable(page);
  await drag(page, [700, 300], [760, 360]);
  const captions = (await markups(page).getAttribute("data-captions")) ?? "";
  expect(captions.split(" | ")).toEqual([expect.any(String), "Rectangle", "White-out"]);
  const lengthCaption = captions.split(" | ")[0];

  await page.getByRole("menubar").getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Editable PDF…" }).click();
  const dialog = page.getByRole("dialog", { name: "Export editable PDF" });
  await expect(dialog.getByTestId("export-count")).toHaveText("3 markups will be written.");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("snap.pdf");
  await expect(page.getByText("Exported snap.pdf", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  const doc = await PDFDocument.load(readFileSync(await file.path()));
  const annots = doc.getPage(0).node.Annots()!;
  const dicts = Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict));
  const subtypes = dicts.map((d) => d.lookup(PDFName.of("Subtype"))!.toString());
  expect(subtypes).toEqual(["/Line", "/Square"]);
  expect(text(dicts[0], "Contents")).toBe(lengthCaption);
  expect(text(dicts[0], "Subj")).toBe("Length");
  expect(text(dicts[1], "T")).not.toBe("");
  // The white-out is drawn into the page, not left as an annotation.
  const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects.keys().some((k) => k.asString().startsWith("/FlatAp"))).toBe(true);
  // The drawing in the app is unchanged.
  await expect(markups(page)).toHaveAttribute("data-captions", captions);
});

// Story 8.2: Flatten (Ctrl+Shift+M) writes a new PDF with the markups drawn into the pages.
test("flatten: Ctrl+Shift+M, the markups drawn into the page, a new file, the markups here unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  await press(page, "r");
  await stable(page);
  await drag(page, [500, 300], [650, 400]);
  await press(page, "Shift+W");
  await stable(page);
  await drag(page, [700, 300], [760, 360]);
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | White-out");

  // File → Flatten… shows the key.
  await page.getByRole("menubar").getByRole("menuitem", { name: "File" }).click();
  await expect(page.getByRole("menuitem", { name: /^Flatten…/ })).toBeEnabled();
  await page.keyboard.press("Escape");

  await press(page, "Control+Shift+M");
  const dialog = page.getByRole("dialog", { name: "Flatten and export" });
  await expect(dialog.getByTestId("export-count")).toHaveText("2 markups will be written.");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Flatten", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("snap (flattened).pdf");
  await expect(page.getByText("Exported snap (flattened).pdf", { exact: true })).toBeVisible();

  const doc = await PDFDocument.load(readFileSync(await file.path()));
  expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects.keys().filter((k) => k.asString().startsWith("/FlatAp"))).toHaveLength(2);
  // The markups here stay editable, as they were.
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | White-out");
});
