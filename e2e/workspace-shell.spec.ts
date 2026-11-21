import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// The admin seed account keeps these sign-ins out of the user@ rate-limit bucket used by auth.spec.ts.
const ADMIN = "admin@plan-markup.test";
const FULL_HD = { width: 1920, height: 1080 };

test.describe.configure({ mode: "serial" });

let storageState: BrowserContextOptions["storageState"];

async function signedInPage(browser: Browser, viewport = FULL_HD): Promise<Page> {
  const context = await browser.newContext({ viewport, storageState });
  const page = await context.newPage();
  if (!storageState) {
    await page.goto("/sign-in");
    await signIn(page, ADMIN);
    await expect(page).toHaveURL("/workspace");
    storageState = await context.storageState();
  } else {
    await page.goto("/workspace");
  }
  // A fresh layout per test: the stored layout is per user and this user is shared.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("menubar", { name: "Main menu" })).toBeVisible();
  return page;
}

test("the shell has its landmarks, menus and empty state", async ({ browser }) => {
  const page = await signedInPage(browser);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Panels" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Tools" })).toBeVisible();

  const menus = page.getByRole("menubar", { name: "Main menu" }).getByRole("menuitem");
  await expect(menus).toHaveText(["File", "Edit", "View", "Document", "Tools", "Window", "Settings", "Help"]);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Drop a PDF here or Open…" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Open…" })).toBeVisible();
  await expect(main.getByText("No recent drawings")).toBeVisible();

  // With both panels open at 1920 × 1080 the canvas keeps at least 1500 × 700 px (UX spec).
  await expect(page.getByRole("complementary", { name: "Tool Chest" })).toBeVisible();
  const box = await main.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(1500);
  expect(box?.height).toBeGreaterThanOrEqual(700);
  await page.context().close();
});

test("a ToolRail button explains why it is disabled", async ({ browser }) => {
  const page = await signedInPage(browser);
  const length = page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Length", exact: true });
  await expect(length).toHaveAttribute("aria-disabled", "true");
  // Keyboard focus opens the tooltip deterministically; Playwright's one-step mouse jumps can
  // leave Radix's pointer-in-transit state set between hovers (hover is unit-tested).
  // The rail scrolls on a short window, and a tooltip closes when its rail scrolls: bring it into view first.
  await length.scrollIntoViewIfNeeded();
  // The scroll event arrives a frame later; focusing before it would open the tooltip only to close it.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
  await length.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Open a drawing first");
  await page.context().close();
});

test("F6 and Shift+F6 cycle the regions", async ({ browser }) => {
  const page = await signedInPage(browser);
  const region = () =>
    page.evaluate(() => (document.activeElement?.closest("[data-region]") as HTMLElement | null)?.dataset.region);
  // Start with focus on the body (outside every region): the first F6 goes to the menu bar.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: (string | undefined)[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("F6");
    seen.push(await region());
  }
  expect(seen).toEqual([
    "menu-bar",
    "toolbar",
    "panel-rail",
    "left-panel",
    "canvas",
    "tool-rail",
    "bottom-panel",
    "status-bar",
  ]);
  await page.keyboard.press("Shift+F6");
  expect(await region()).toBe("bottom-panel");
  await page.context().close();
});

test("panel state survives a reload", async ({ browser }) => {
  const page = await signedInPage(browser);
  await page.getByRole("button", { name: "Collapse Tool Chest" }).click();
  await expect(page.getByRole("complementary", { name: "Tool Chest" })).toHaveCount(0);

  const handle = page.getByRole("separator", { name: "Resize Markups" });
  await handle.focus();
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "480");

  // Saves are debounced by 200 ms.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByRole("menubar", { name: "Main menu" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Tool Chest" })).toHaveCount(0);
  await expect(page.getByRole("separator", { name: "Resize Markups" })).toHaveAttribute("aria-valuenow", "480");
  await page.context().close();
});

test("panels start collapsed at 1366 × 768", async ({ browser }) => {
  const page = await signedInPage(browser, { width: 1366, height: 768 });
  await expect(page.getByRole("complementary", { name: "Tool Chest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand Markups" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Screen size notice" })).toHaveCount(0);
  await page.context().close();
});

test("below 1280 px a dismissible banner shows until a new session", async ({ browser }) => {
  const page = await signedInPage(browser, { width: 1200, height: 800 });
  const banner = page.getByRole("region", { name: "Screen size notice" });
  await expect(banner).toHaveText("Plan Markup is designed for screens 1280 px or wider");
  await banner.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("menubar", { name: "Main menu" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.context().close();

  // A new browser context is a new session: the banner is back.
  const fresh = await signedInPage(browser, { width: 1200, height: 800 });
  await expect(fresh.getByRole("region", { name: "Screen size notice" })).toBeVisible();
  await fresh.context().close();
});

test("sign out from the account menu", async ({ browser }) => {
  const page = await signedInPage(browser);
  await page.getByRole("button", { name: /^Account: / }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.context().close();
  // The shared session ended server-side; the next test signs in again.
  storageState = undefined;
});

test("sign out from the File menu", async ({ browser }) => {
  const page = await signedInPage(browser);
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.context().close();
  storageState = undefined;
});
