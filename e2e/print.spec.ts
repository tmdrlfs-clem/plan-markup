// Story 8.3: Print (Ctrl+P) on the committed fixture fixtures/pdf/snap.pdf.
// Covers: Ctrl+P opens our print dialog (not the browser's); it lists the
// pages, the markups choice, the paper and the scale; Print makes the print
// PDF and hands it to a hidden blob: frame for the browser's print dialog,
// then closes. File → Print… and the toolbar's Print… open the same dialog.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

test("Ctrl+P opens the print dialog and Print hands a print PDF to the browser", async ({ page }) => {
  // Headless Chromium has no PDF viewer, so a PDF frame never fires "load" (headed
  // Chrome does): fire it once the print frame is attached, and count print().
  await page.addInitScript(() => {
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes: (Node | string)[]) {
      append.apply(this, nodes);
      for (const node of nodes) {
        if (node instanceof HTMLIFrameElement && node.title === "Print") {
          setTimeout(() => {
            if (node.contentWindow) node.contentWindow.print = () => void ((window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1);
            node.dispatchEvent(new Event("load"));
          }, 50);
        }
      }
    };
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await expect(page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Print…" })).toBeDisabled();
  await open(page);

  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "Print" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("print-summary")).toHaveText("2 pages, 0 markups.");
  await dialog.getByRole("checkbox", { name: "Print markups" }).click();
  await expect(dialog.getByTestId("print-summary")).toHaveText("2 pages, without markups.");
  await dialog.getByRole("button", { name: "Print" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('iframe[title="Print"]')).toHaveAttribute("src", /^blob:/);
  expect(await page.evaluate(() => (window as unknown as { printed?: number }).printed)).toBe(1);

  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Print…" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("menubar").getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /^Print…/ }).click();
  await expect(dialog).toBeVisible();
});
