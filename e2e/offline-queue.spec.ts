// Story 6.3: the offline queue and the SaveIndicator (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: a line saves (✓ Saved); offline, an arrow and the line's delete wait
// in the queue ("Offline — 2 changes waiting"); with the server still out of
// reach the page reloads (the queue is in IndexedDB) and the file is opened
// again (the session brings the markups back); once the server is back,
// Ctrl+S sends the queue in order (the browser's save dialog never opens) and
// the rows are all there; a change after the reload (the arrow's delete) is
// saved too. Rows are read with the local database.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import pg from "pg";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf"));
const SHA = createHash("sha256").update(PDF).digest("hex");
const EMAIL = "offline@plan-markup.test";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markupsCanvas = (page: Page) => page.getByTestId("markups-canvas");
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

const OWNER = `(select id from auth.users where email = $2)`;
const summary = async () =>
  (
    await query<{ type: string; deleted: boolean }>(
      `select m.type, m.deleted_at is not null as deleted
       from public.markups m join public.drawings d on d.id = m.drawing_id join public.drawing_files f on f.drawing_id = d.id
       where f.sha256 = $1 and d.owner_id = ${OWNER} order by m.created_at`,
      [SHA, EMAIL],
    )
  ).map((r) => `${r.type}${r.deleted ? " deleted" : ""}`);

async function openFile(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: PDF });
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

async function arm(page: Page, key: string, hint: RegExp) {
  await press(page, key);
  await expect(page.getByText(hint)).toBeVisible();
  await stable(page);
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

async function selectAt(page: Page, x: number, y: number) {
  await press(page, "Escape");
  await press(page, "v");
  await stable(page);
  const at = await screenOf(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** Server actions (the saves) fail as if the server were out of reach; pages still load. */
const blockSaves = (route: Route) =>
  route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("internetdisconnected") : route.continue();

test("offline queue: edits wait offline, survive a reload and are all saved after reconnecting; SaveIndicator states; Ctrl+S", async ({ browser }) => {
  await query(`delete from public.drawings d using public.drawing_files f where f.drawing_id = d.id and f.sha256 = $1 and d.owner_id = ${OWNER}`, [SHA, EMAIL]);
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, EMAIL);
  await expect(page).toHaveURL("/workspace");
  await openFile(page);

  // Online: a line saves.
  await arm(page, "l", /^Line: click the start/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 250);
  await expect(saveItem(page)).toHaveAttribute("data-state", "saved");
  await expect(saveItem(page)).toHaveText("Saved");
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line"]);

  // Offline: an arrow and the line's delete wait in the queue.
  await context.setOffline(true);
  await arm(page, "a", /^Arrow: click the start/);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 250);
  await selectAt(page, 200, 175);
  await press(page, "Delete");
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Arrow");
  await expect(saveItem(page)).toHaveText("Offline — 2 changes waiting");
  await expect(saveItem(page)).toHaveAttribute("data-state", "offline");
  // The details say so, and offer Retry.
  await saveItem(page).click();
  await expect(page.getByTestId("save-details")).toContainText("2 changes waiting on this computer");
  await page.keyboard.press("Escape");
  expect(await summary()).toEqual(["line"]);

  // Back on the network, but the server is still out of reach: reload.
  await context.route("**/*", blockSaves);
  await context.setOffline(false);
  await page.reload();
  await expect(page).toHaveURL("/workspace");
  await openFile(page);
  // The session brings the markups back; nothing reached the server.
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Arrow");
  await expect(saveItem(page)).not.toHaveAttribute("data-state", "saved");
  expect(await summary()).toEqual(["line"]);

  // The server is back: Ctrl+S sends the queue (no browser save dialog: the page stays usable).
  await context.unroute("**/*", blockSaves);
  await press(page, "Control+s");
  await expect.poll(summary, { timeout: 15_000 }).toEqual(["line deleted", "arrow"]);
  await expect(saveItem(page)).toHaveText("Saved");

  // A change after the reload is saved too (the snapshot survived the reload).
  await selectAt(page, 200, 250);
  await press(page, "Delete");
  await expect(markupsCanvas(page)).not.toHaveAttribute("data-captions", /.+/);
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line deleted", "arrow deleted"]);
  await expect(saveItem(page)).toHaveAttribute("data-state", "saved");
  await context.close();
});
