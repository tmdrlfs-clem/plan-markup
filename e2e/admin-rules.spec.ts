// Story 10.13 (FR79, A7): the platform admin maintains the rule figures (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: admin → Rule figures shows the version in use; bad figures are refused
// at their cell; an edit is saved as the next version, a draft, with its source
// and what changed; the draft is in use for nobody (a user's zone still shows the
// version in use and its figures); the page is a 404 for other users; the edit
// is audit-logged.
//
// Not covered here: confirming a version. It changes the figures every other
// spec places and checks with (the specs run in parallel on one database), so it
// is covered by pgTAP (rule_figures_admin.test.sql) and the unit tests. The
// draft this spec adds is removed again at the end.
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const PASSWORD = "admin rules e2e password";
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const panel = (page: Page) => page.getByTestId("sprinkler-panel");

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

/** Alt+4 shows the 4541 panel (the calibration call on an uncalibrated page). */
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

type FigureRow = { version: string; verified: boolean; amax: string };
const versions = () =>
  sql<FigureRow>(
    `select version, verified, hazards -> 'ELH' ->> 'Amax' as amax from public.rule_figures
      where ruleset_id = 'nzs4541' order by version::integer desc`,
  );

test("the admin saves edited rule figures as a draft version; nobody uses it until it is confirmed", async ({ browser }) => {
  test.setTimeout(180_000);
  const tag = crypto.randomUUID().slice(0, 12);
  const admin = `rfadm-${tag}@plan-markup.test`;
  const user = `rfuser-${tag}@plan-markup.test`;
  await makeActiveUser(admin, PASSWORD);
  await makeActiveUser(user, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true where email = $1", [admin]);

  const before = await versions();
  const inUse = before.find((v) => v.verified)!;
  const newest = before[0];
  const next = String(Number(newest.version) + 1);
  // A value the newest version does not have, so the save always adds a version.
  const amax = Number(newest.amax) === 20 ? "20.5" : "20";

  const adminCtx = await browser.newContext();
  const userCtx = await browser.newContext();
  try {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`/sign-in?next=${encodeURIComponent("/admin/rules")}`);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL("/admin/rules");
    await expect(page.getByRole("heading", { name: "Rule figures", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Rule figures" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("rules-in-use")).toHaveText(`NZS 4541 v${inUse.version} is in use.`);
    await expect(page.getByTestId("rule-version-row")).toHaveCount(before.length);

    const cell = page.getByRole("textbox", { name: "Max area per head of ELH, in square metres" });
    const save = page.getByRole("button", { name: "Save as a new version" });
    await expect(save).toBeEnabled();
    await expect(cell).toHaveValue(String(Number(newest.amax)));

    // Refused at the cell and at the source; nothing is saved.
    await cell.fill("0");
    await save.click();
    await expect(page.getByText("ELH max area per head: Must be above 0.", { exact: true })).toBeVisible();
    await expect(page.getByText("Say where the figures come from.", { exact: true })).toBeVisible();
    await expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(await versions()).toHaveLength(before.length);

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // An edit: the next version, a draft.
    await cell.fill(amax);
    await page.getByRole("textbox", { name: "Source of the change" }).fill(`e2e ${tag}: clause 5 correction`);
    await save.click();
    await expect(page.getByText(`Saved as v${next}, a draft.`, { exact: true })).toBeVisible();
    const draft = page.getByTestId("rules-draft");
    await expect(draft).toContainText(`v${next} is a draft. Nobody uses it yet.`);
    await expect(draft.getByRole("button", { name: `Confirm v${next}` })).toBeVisible();
    await expect(page.getByTestId("rules-in-use")).toHaveText(`NZS 4541 v${inUse.version} is in use.`);
    const rows = page.getByTestId("rule-version-row");
    await expect(rows).toHaveCount(before.length + 1);
    await expect(rows.first()).toContainText(`v${next}`);
    await expect(rows.first()).toContainText("Draft");
    await expect(rows.first()).toContainText(`e2e ${tag}: clause 5 correction`);
    await expect(rows.first()).toContainText(`ELH Amax ${Number(newest.amax)} → ${amax}`);

    // Confirming asks first; cancelling confirms nothing.
    await draft.getByRole("button", { name: `Confirm v${next}` }).click();
    const dialog = page.getByRole("alertdialog", { name: `Put v${next} in use?` });
    await expect(dialog).toContainText("every new placement and every check uses them");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    const after = await versions();
    expect(after[0]).toMatchObject({ version: next, verified: false });
    expect(Number(after[0].amax)).toBe(Number(amax));
    expect(after.slice(1)).toEqual(before);

    // The same figures again add nothing.
    await page.getByRole("textbox", { name: "Source of the change" }).fill("again");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await expect(page.getByText(`Nothing changed: these are the figures of v${next}.`, { exact: true })).toBeVisible();
    expect(await versions()).toHaveLength(before.length + 1);

    // Another user: no admin page, and their zone still shows the version in use, not the draft.
    const userPage = await userCtx.newPage();
    await userPage.setViewportSize({ width: 1600, height: 900 });
    await userPage.goto("/sign-in");
    await signIn(userPage, user, PASSWORD);
    await expect(userPage).toHaveURL("/workspace");
    expect((await userPage.goto("/admin/rules"))?.status()).toBe(404);
    await userPage.goto("/workspace");
    await openPdf(userPage);
    await showPanel(userPage);
    await userPage.getByTestId("sprinkler-calibrate-first").getByRole("button", { name: "Calibrate" }).click();
    await calibrate(userPage).getByTestId("calibrate-ratio").fill("1:100");
    await calibrate(userPage).getByRole("button", { name: "Apply" }).click();
    await expect(calibrate(userPage)).toBeHidden();
    await drawZone(userPage, [
      [110, 110],
      [290, 110],
      [290, 240],
      [110, 240],
    ]);
    await expect(panel(userPage).getByTestId("zone-row")).toHaveCount(1);
    const figures = panel(userPage).getByTestId("zone-figures");
    await expect(figures).toContainText(`ELH · NZS 4541 v${inUse.version}`);
    await expect(figures.getByTestId("figure-Amax")).toContainText(`${Number(inUse.amax)} m²`);

    // The edit is recorded, with the figures before and after.
    const log = await sql<{ action: string; detail: { version: string; from_version: string; source: string; to: { ELH: { Amax: number } } } }>(
      `select a.action, a.detail from public.audit_log a
        where a.actor_id = (select id from public.profiles where email = $1) and a.action like 'rules.%' order by a.occurred_at`,
      [admin],
    );
    expect(log.map((r) => r.action)).toEqual(["rules.figures_created"]);
    expect(log[0].detail).toMatchObject({ version: next, from_version: newest.version, source: `e2e ${tag}: clause 5 correction` });
    expect(Number(log[0].detail.to.ELH.Amax)).toBe(Number(amax));
  } finally {
    await adminCtx.close();
    await userCtx.close();
    await sql("delete from public.rule_figures where created_by = (select id from public.profiles where email = $1) and not verified", [admin]);
    await deleteUser(admin, user);
  }
});
