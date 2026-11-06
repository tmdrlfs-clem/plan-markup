// Story 6.4: markups come back when the same PDF is opened again (production build in CI).
//   scales.pdf (Story 4.2): 5 pages, page 1 A1 "SCALE 1:100 @ A1".
// Covers: a calibration and a line saved in one browser come back in another
// (no session, nothing on the computer: from the server) after the first
// frame, with ✓ Saved; a new tab of that browser shows them even when the
// server cannot be reached (the copy on the computer); the same drawing with
// other bytes (a file changed outside the app) opens with no markups.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import pg from "pg";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf"));
/** The same drawing changed outside the app: other bytes, another hash. */
const CHANGED = Buffer.concat([PDF, Buffer.from("\n% changed outside the app\n")]);
const EMAIL = "restore@plan-markup.test";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markupsCanvas = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const saveItem = (page: Page) => page.getByTestId("status-bar").getByTestId("status-save");

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const OWNER = `(select id from auth.users where email = $1)`;

async function signedIn(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, EMAIL);
  await expect(page).toHaveURL("/workspace");
  return { context, page };
}

async function openFile(page: Page, buffer: Buffer = PDF) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}

async function press(page: Page, key: string) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press(key);
}

const blockSaves = (route: Route) =>
  route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("internetdisconnected") : route.continue();

test("restore: the same PDF brings back its markups and calibration (server, then this computer); other bytes open empty", async ({ browser }) => {
  await query(`delete from public.drawings where owner_id = ${OWNER}`, [EMAIL]);

  // Browser 1: calibrate page 1 and draw a line; both are saved.
  const one = await signedIn(browser);
  await openFile(one.page);
  await expect(scale(one.page)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });
  await scale(one.page).click();
  await one.page.getByRole("dialog", { name: "Calibrate" }).getByRole("button", { name: "Use detected 1:100 @ A1" }).click();
  await expect(scale(one.page)).toHaveText("Scale 1:100");
  await press(one.page, "l");
  const box = (await canvas(one.page).boundingBox())!;
  await one.page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await one.page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect(markupsCanvas(one.page)).toHaveAttribute("data-captions", "Line");
  await expect
    .poll(async () => (await query<{ n: number }>(`select count(*)::int as n from public.markups m join public.drawings d on d.id = m.drawing_id where d.owner_id = ${OWNER} and m.deleted_at is null`, [EMAIL]))[0].n, { timeout: 10_000 })
    .toBe(1);
  await expect(saveItem(one.page)).toHaveText("Saved");
  await one.context.close();

  // Browser 2 (nothing on this computer): from the server, after the first frame.
  const two = await signedIn(browser);
  await openFile(two.page);
  await expect(markupsCanvas(two.page)).toHaveAttribute("data-captions", "Line", { timeout: 10_000 });
  await expect(scale(two.page)).toHaveText("Scale 1:100");
  await expect(saveItem(two.page)).toHaveText("Saved");

  // A new tab of browser 2 with the server out of reach: the copy on this computer.
  await two.context.route("**/*", blockSaves);
  const tab = await two.context.newPage();
  await tab.goto("/workspace");
  await openFile(tab);
  await expect(markupsCanvas(tab)).toHaveAttribute("data-captions", "Line", { timeout: 10_000 });
  await expect(scale(tab)).toHaveText("Scale 1:100");
  await two.context.unroute("**/*", blockSaves);

  // The same drawing with other bytes: a new drawing, no markups moved over.
  const other = await two.context.newPage();
  await other.goto("/workspace");
  await openFile(other, CHANGED);
  await expect(scale(other)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });
  await other.waitForTimeout(1_000);
  await expect(markupsCanvas(other)).not.toHaveAttribute("data-captions", /.+/);
  await expect(scale(other)).not.toHaveText("Scale 1:100");
  await two.context.close();
});
