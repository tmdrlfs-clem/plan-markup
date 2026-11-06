// Story 6.2: markups saved through the ops RPC (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: drawing a line saves it (version 1, its author, page 1's id, its
// fields); moving it updates its geometry only; Delete writes a tombstone;
// Ctrl+Z restores it (A4); an arrow keeps its drawing order above the line.
// Then undo/redo of the arrow 20 times measures the op round trip (NFR4:
// ≤500 ms p95 on the local stack). Rows are read with the local database (the
// app restores them from Story 6.4).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import pg from "pg";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf"));
const SHA = createHash("sha256").update(PDF).digest("hex");
const EMAIL = "admin@plan-markup.test";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markupsCanvas = (page: Page) => page.getByTestId("markups-canvas");

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
type Row = { type: string; version: number; deleted: boolean; page_index: number; own_author: boolean; x0: number; color: string; z: number; created_by_client: string };
const rows = () =>
  query<Row>(
    `select m.type, m.version, m.deleted_at is not null as deleted, p.index as page_index, m.author_id = ${OWNER} as own_author,
            (m.geometry -> 'points' -> 0 ->> 'x')::float as x0, m.style ->> 'color' as color, m.z, m.props ->> 'createdAt' as created_by_client
     from public.markups m join public.pages p on p.id = m.page_id join public.drawings d on d.id = m.drawing_id
     join public.drawing_files f on f.drawing_id = d.id
     where f.sha256 = $1 and d.owner_id = ${OWNER} order by m.created_at, m.z`,
    [SHA, EMAIL],
  );
const summary = async () => (await rows()).map((r) => `${r.type} v${r.version}${r.deleted ? " deleted" : ""}`);

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

/** A markup ops call: a server action whose body carries ops. */
const isOpsCall = (r: Request) => r.method() === "POST" && Boolean(r.headers()["next-action"]) && (r.postData() ?? "").includes('"baseVersion"');

test("markup ops: draw, move, delete and undo save to the server; the op round trip is ≤500 ms p95", async ({ browser }) => {
  await query(`delete from public.drawings d using public.drawing_files f where f.drawing_id = d.id and f.sha256 = $1 and d.owner_id = ${OWNER}`, [SHA, EMAIL]);
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const calls: Request[] = [];
  page.on("request", (r) => {
    if (isOpsCall(r)) calls.push(r);
  });
  await page.goto("/sign-in");
  await signIn(page, EMAIL);
  await expect(page).toHaveURL("/workspace");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });

  // Draw: a line, saved with every field on page 1, by its author.
  await arm(page, "l", /^Line: click the start/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 250);
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Line");
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line v1"]);
  const [created] = await rows();
  expect(created).toMatchObject({ page_index: 0, own_author: true, x0: 100, color: expect.stringMatching(/^#[0-9a-f]{6}$/i) });
  expect(created.created_by_client).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  // Edit: move it (Select, drag its middle); only its geometry changes.
  await press(page, "Escape");
  await press(page, "v");
  await stable(page);
  const mid = await screenOf(page, 200, 175);
  await page.mouse.click(mid.x, mid.y);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 20, mid.y, { steps: 5 });
  await page.mouse.move(mid.x + 40, mid.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await rows())[0]?.x0, { timeout: 10_000 }).toBeGreaterThan(100);
  expect(await summary()).toEqual(["line v2"]);
  expect((await rows())[0].color).toBe(created.color);

  // Delete: a tombstone; undo restores it.
  await press(page, "Delete");
  await expect(markupsCanvas(page)).not.toHaveAttribute("data-captions", /.+/);
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line v3 deleted"]);
  await press(page, "Control+z");
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Line");
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line v4"]);

  // An arrow on top: saved above the line in drawing order.
  await arm(page, "a", /^Arrow: click the start/);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 250);
  await expect(markupsCanvas(page)).toHaveAttribute("data-captions", "Line | Arrow");
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line v4", "arrow v1"]);
  const [lineRow, arrowRow] = await rows();
  expect(arrowRow.z).toBeGreaterThan(lineRow.z);

  // NFR4: undo/redo the arrow 20 times, one change per save; each round trip is timed.
  await press(page, "Escape");
  const timed: number[] = [];
  for (let i = 0; i < 20; i++) {
    const call = page.waitForRequest(isOpsCall);
    await press(page, i % 2 === 0 ? "Control+z" : "Control+y");
    const request = await call;
    await request.response();
    await expect.poll(() => request.timing().responseEnd, { timeout: 5_000 }).toBeGreaterThan(0);
    timed.push(request.timing().responseEnd);
  }
  await expect.poll(summary, { timeout: 10_000 }).toEqual(["line v4", "arrow v21"]);
  const sorted = [...timed].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  console.log(`markup ops round trip: median ${sorted[sorted.length >> 1].toFixed(0)} ms, p95 ${p95.toFixed(0)} ms (n=${sorted.length})`);
  expect(p95).toBeLessThanOrEqual(500);
  expect(calls.length).toBeGreaterThanOrEqual(24);
  await context.close();
});
