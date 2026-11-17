// Story 10.12 (FR72): a company's own use → hazard mapping (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Company → 4541 settings starts from the platform default; the admin
// adds a use, makes it the default and saves (v1); a member's new zone is that
// use with its hazard class, from the company mapping; a member cannot open the
// settings; the admin goes back to the platform default: the zone already drawn
// keeps its use and hazard class and a new zone is Office (ELH) again; both
// changes are audit-logged.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const PASSWORD = "company use map e2e password";
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const panel = (page: Page) => page.getByTestId("sprinkler-panel");
const saveItem = (page: Page) => page.getByTestId("status-bar").getByTestId("status-save");

/** Screen position of user space point (x, y) on the unrotated A4 page. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
}

async function stable(page: Page) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = `${JSON.stringify(await canvas(page).boundingBox())} ${await canvas(page).getAttribute("data-view")}`;
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [100, 100, 200, 200, 400] },
    )
    .toBe(true);
}

async function openPdf(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
}

/** Alt+4 shows or hides the 4541 panel (the calibration call on an uncalibrated page), and a reload keeps it as it was. */
async function showPanel(page: Page) {
  const shown = panel(page).or(page.getByTestId("sprinkler-calibrate-first")).first();
  await expect(async () => {
    if (!(await shown.isVisible())) {
      await canvas(page).focus();
      await page.keyboard.press("Alt+4");
    }
    await expect(shown).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Adds a zone with these corners (user space) from the 4541 panel. */
async function drawZone(page: Page, corners: readonly (readonly [number, number])[]) {
  await panel(page).getByRole("button", { name: "Polygon zone" }).click();
  await stable(page);
  for (const [x, y] of corners) {
    const at = await screenOf(page, x, y);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press("Enter");
}

async function workspace(page: Page, email: string) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL("/workspace");
}

const audit = (company: string) =>
  sql<{ action: string; actor: string; detail: unknown }>(
    `select a.action, pa.email as actor, a.detail from public.audit_log a join public.profiles pa on pa.id = a.actor_id
      where a.target_id = (select id from public.companies where name = $1) and a.action like 'company.use_hazard_map_%' order by a.occurred_at`,
    [company],
  );

test("a company admin edits the use → hazard mapping: new zones of the company follow it", async ({ browser }) => {
  test.setTimeout(180_000);
  const tag = crypto.randomUUID().slice(0, 12);
  const platform = `ump-${tag}@plan-markup.test`;
  const boss = `umboss-${tag}@plan-markup.test`;
  const member = `ummember-${tag}@plan-markup.test`;
  const company = `Use Map Co ${tag}`;
  for (const email of [platform, boss, member]) await makeActiveUser(email, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true where email = $1", [platform]);
  await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, company, boss]);
  await sql(
    `insert into public.company_members (user_id, company_id, role)
     select (select id from public.profiles where email = $1), (select id from public.companies where name = $2), 'member'`,
    [member, company],
  );

  const bossCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  try {
    // The admin: the settings start from the platform default.
    const page = await bossCtx.newPage();
    await workspace(page, boss);
    await page.goto("/company/4541");
    await expect(page.getByRole("heading", { name: "4541 settings", level: 1 })).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "4541 settings" }).waitFor();
    const source = page.getByTestId("use-map-source");
    await expect(source).toContainText(`${company} follows the platform default mapping`);
    await expect(page.getByTestId("use-row")).toHaveCount(8);
    await expect(page.getByRole("radio", { name: "Office is the default use" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Use the platform default" })).toHaveCount(0);

    // A use of their own, the default from now on.
    const add = page.getByRole("button", { name: "Add a use" });
    await expect(add).toBeEnabled();
    await add.click();
    const name = page.getByRole("textbox", { name: "Name of use 9" });
    await expect(name).toBeFocused();
    await name.fill("office");
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText("“office” is listed twice.", { exact: true })).toBeVisible();
    await name.fill("Cool store");
    await page.getByRole("combobox", { name: "Hazard class of Cool store" }).selectOption("OH3");
    await page.getByRole("radio", { name: "Cool store is the default use" }).check();
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText("Mapping saved (v1).", { exact: true })).toBeVisible();
    await expect(source).toHaveText(`${company} has its own mapping (v1).`);
    await expect(page.getByTestId("use-row")).toHaveCount(9);
    await expect(page.getByRole("radio", { name: "Cool store is the default use" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Use the platform default" })).toBeVisible();

    // A member cannot open the settings; their new zone follows the company mapping.
    const memberPage = await memberCtx.newPage();
    await workspace(memberPage, member);
    expect((await memberPage.goto("/company/4541"))?.status()).toBe(404);
    await memberPage.goto("/workspace");
    await openPdf(memberPage);
    await showPanel(memberPage);
    await memberPage.getByTestId("sprinkler-calibrate-first").getByRole("button", { name: "Calibrate" }).click();
    await calibrate(memberPage).getByTestId("calibrate-ratio").fill("1:100");
    await calibrate(memberPage).getByRole("button", { name: "Apply" }).click();
    await expect(calibrate(memberPage)).toBeHidden();
    await drawZone(memberPage, [
      [110, 110],
      [290, 110],
      [290, 240],
      [110, 240],
    ]);
    const rows = panel(memberPage).getByTestId("zone-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Cool store");
    await expect(rows.first().getByTestId("hazard-chip")).toHaveText("OH3");
    await expect(panel(memberPage).getByTestId("zone-figures").getByTestId("mapping-source")).toHaveText("Company mapping v1");
    await expect(saveItem(memberPage)).toHaveText("Saved");

    // Back to the platform default, after confirming.
    await page.getByRole("button", { name: "Use the platform default" }).click();
    await page.getByRole("alertdialog", { name: "Go back to the platform default?" }).getByRole("button", { name: "Use the platform default" }).click();
    await expect(page.getByText("Your company uses the platform default mapping again.", { exact: true })).toBeVisible();
    await expect(source).toContainText(`${company} follows the platform default mapping`);
    await expect(page.getByTestId("use-row")).toHaveCount(8);

    // The zone already drawn keeps its use and hazard class; a new one follows the platform default.
    await memberPage.reload();
    await openPdf(memberPage);
    await showPanel(memberPage);
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(rows.first()).toContainText("Cool store");
    await expect(rows.first().getByTestId("hazard-chip")).toHaveText("OH3");
    await drawZone(memberPage, [
      [400, 300],
      [600, 300],
      [600, 450],
      [400, 450],
    ]);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("Office");
    await expect(rows.nth(1).getByTestId("hazard-chip")).toHaveText("ELH");
    await expect(rows.first().getByTestId("hazard-chip")).toHaveText("OH3");

    const log = await audit(company);
    expect(log.map((r) => [r.action, r.actor])).toEqual([
      ["company.use_hazard_map_changed", boss],
      ["company.use_hazard_map_reset", boss],
    ]);
    expect(log[0].detail).toMatchObject({ version: "1", from: null, to: { default: "Cool store", uses: { "Cool store": "OH3", Office: "ELH" } } });
    expect(log[1].detail).toMatchObject({ from: { default: "Cool store" } });
  } finally {
    await bossCtx.close();
    await memberCtx.close();
    await sql("delete from public.companies where name like $1", [`%${tag}%`]);
    await deleteUser(platform, boss, member);
  }
});
