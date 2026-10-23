// Story 3.8: Settings > Appearance on the production build. Switches all
// three themes from the menu (chrome, <html> for portals, and the canvas
// backdrop pixel), axe-core once per theme (no serious or critical
// violations), the choice kept on the profile across a reload and already in
// the server-rendered HTML (no flash), and the sign-in page staying Blueprint
// whatever localStorage says. Uses its own seeded user (theme@), so other
// specs never see a changed theme.
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "multi-page.pdf");
const THEME_USER = "theme@plan-markup.test";

// globals.css: each theme's --canvas-backdrop and Blueprint's --surface-0.
const BACKDROP = { blueprint: [229, 231, 235], daylight: [217, 219, 223], contrast: [0, 0, 0] } as const;
const BLUEPRINT_SURFACE_0 = "rgb(16, 21, 28)";
const LABEL = { blueprint: "Blueprint", daylight: "Daylight", contrast: "High contrast" } as const;
type Theme = keyof typeof LABEL;

const root = (page: Page) => page.getByTestId("workspace-root");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function choose(page: Page, theme: Theme) {
  await page.getByRole("menubar", { name: "Main menu" }).getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: LABEL[theme] }).click();
  await expect(root(page)).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** The tiles canvas's top-left pixel: the backdrop around the fitted sheet. */
async function backdropPixel(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("[data-testid='tiles-canvas']")!;
    return Array.from(c.getContext("2d")!.getImageData(2, 2, 1, 1).data.slice(0, 3));
  });
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("[data-testid='workspace-root']").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("themes: switch all three from Settings > Appearance, canvas follows, axe clean, kept on the profile, sign-in stays Blueprint", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, THEME_USER);
  await expect(page).toHaveURL("/workspace");
  // A failed earlier run may have left another theme: start from Blueprint.
  if ((await root(page).getAttribute("data-theme")) !== "blueprint") await choose(page, "blueprint");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "multi-page.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");

  const violations: Record<string, string[]> = {};
  for (const theme of ["blueprint", "daylight", "contrast"] as const) {
    if (theme !== "blueprint") await choose(page, theme);
    await expect.poll(() => backdropPixel(page)).toEqual([...BACKDROP[theme]]);
    violations[theme] = await seriousViolations(page);
  }
  expect(violations).toEqual({ blueprint: [], daylight: [], contrast: [] });

  // Kept on the profile: a reload comes back in High contrast, already in the server's HTML.
  const html = await (await context.request.get("/workspace")).text();
  expect(html).toMatch(/data-theme="contrast"[^>]*data-testid="workspace-root"|data-testid="workspace-root"[^>]*data-theme="contrast"/);
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-theme", "contrast");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");

  // Back to Blueprint for the next run.
  await choose(page, "blueprint");
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-theme", "blueprint");
  await context.close();

  // The sign-in page is Blueprint whatever this browser last chose.
  const anon = await browser.newContext();
  await anon.addInitScript(() => localStorage.setItem("pm.theme.v1", "daylight"));
  const signInPage = await anon.newPage();
  await signInPage.goto("/sign-in");
  await expect(signInPage.locator("html")).toHaveAttribute("data-theme", "blueprint");
  await expect(signInPage.locator("body")).toHaveCSS("background-color", BLUEPRINT_SURFACE_0);
  await anon.close();
});
