// Story 6.1: a file's markup set on the committed fixture (production build in CI).
//   scales.pdf (Story 4.2): 5 pages, page 1 A1 "SCALE 1:100 @ A1".
// Covers: opening the PDF makes nothing on the server; the first calibration
// makes the drawing, its file (by the bytes' SHA-256) and its 5 pages, and
// saves the calibration by page id; undo removes it; no request carries PDF
// bytes and nothing touches Storage (NFR26). Read back with the local
// database (the rows a user cannot see from the app until Story 6.4).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import pg from "pg";
import { signIn } from "./helpers";

const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "pdf", "scales.pdf"));
const SHA = createHash("sha256").update(PDF).digest("hex");
const EMAIL = "sync@plan-markup.test";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");

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
const files = () =>
  query<{ filename: string; page_count: number; pages: number; title: string; storage_path: string | null }>(
    `select f.filename, f.page_count, f.storage_path, d.title, (select count(*)::int from public.pages p where p.drawing_file_id = f.id) as pages
     from public.drawing_files f join public.drawings d on d.id = f.drawing_id
     where f.sha256 = $1 and d.owner_id = ${OWNER}`,
    [SHA, EMAIL],
  );
const calibrations = () =>
  query<{ index: number; ratio: number }>(
    `select p.index, (c.calibration ->> 'ratio')::float as ratio
     from public.calibrations c join public.pages p on p.id = c.page_id
     join public.drawing_files f on f.id = p.drawing_file_id join public.drawings d on d.id = f.drawing_id
     where f.sha256 = $1 and d.owner_id = ${OWNER} order by p.index`,
    [SHA, EMAIL],
  );

test("markup set: none on open; the first calibration makes it and saves by page id; undo removes it; no PDF bytes sent", async ({ browser }) => {
  await query(`delete from public.drawings d using public.drawing_files f where f.drawing_id = d.id and f.sha256 = $1 and d.owner_id = ${OWNER}`, [SHA, EMAIL]);
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  await page.goto("/sign-in");
  await signIn(page, EMAIL);
  await expect(page).toHaveURL("/workspace");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "scales.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(scale(page)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });
  // Opening (and looking) makes nothing.
  expect(await files()).toEqual([]);

  // The first calibration makes the set and saves itself by page id.
  await scale(page).click();
  await page.getByRole("dialog", { name: "Calibrate" }).getByRole("button", { name: "Use detected 1:100 @ A1" }).click();
  await expect(scale(page)).toHaveText("Scale 1:100");
  await expect.poll(files, { timeout: 10_000 }).toEqual([{ filename: "scales.pdf", page_count: 5, pages: 5, title: "scales.pdf", storage_path: null }]);
  await expect.poll(calibrations, { timeout: 10_000 }).toEqual([{ index: 0, ratio: 100 }]);

  // Undo removes it there too; the set stays.
  await page.mouse.move(5, 500);
  await page.keyboard.press("Control+z");
  await expect(scale(page)).not.toHaveText("Scale 1:100");
  await expect.poll(calibrations, { timeout: 10_000 }).toEqual([]);
  expect(await files()).toHaveLength(1);

  // NFR26: no request body carries the PDF's first 1 KB and nothing touches Storage.
  const head = PDF.subarray(0, 1024);
  for (const r of requests) {
    expect(r.url(), "no Storage call").not.toMatch(/\/storage\/v1\//);
    const body = r.postDataBuffer();
    if (body) expect(body.includes(head), `request body of ${r.method()} ${r.url()}`).toBe(false);
  }
  await context.close();
});
