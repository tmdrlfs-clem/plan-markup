// Story 10.11 (FR44): company tool sets (production build in CI).
//   fixtures/btx/synthetic.btx (Story 2.1): "Synthetic Tools", five items, one an image stamp.
// Covers: a company admin publishes one of their sets; a member sees it at the
// top of the Tool Chest marked Company, every tile drawn (the image one too),
// with Export and nothing that changes it; someone outside the company sees
// nothing; publishing and withdrawing are audit-logged; after the admin
// withdraws the set the member no longer has it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

const SYNTHETIC = path.join(__dirname, "..", "fixtures", "btx", "synthetic.btx");
const PASSWORD = "company tool sets e2e password";

const chest = (page: Page) => page.getByRole("complementary", { name: "Tool Chest" });
const setNames = (page: Page) => chest(page).getByTestId("tool-set").locator("button[aria-expanded]");

async function showChest(page: Page) {
  await expect(async () => {
    const radio = page.getByRole("radio", { name: "Tool Chest" });
    if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
    await expect(chest(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function openWorkspace(page: Page, email: string) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
}

/** Whether each tile's preview has something drawn on it. */
const drawn = (page: Page) =>
  chest(page)
    .getByTestId("tool-preview")
    .evaluateAll((els) =>
      els.map((el) => {
        const c = el as HTMLCanvasElement;
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
        return ink > 0;
      }),
    );

const audit = (company: string) =>
  sql<{ action: string; actor: string; name: string }>(
    `select a.action, pa.email as actor, a.detail ->> 'name' as name from public.audit_log a join public.profiles pa on pa.id = a.actor_id
      where a.target_id = (select id from public.companies where name = $1) and a.action like 'company.tool_set_%' order by a.occurred_at`,
    [company],
  );

test("a company admin publishes a tool set: members use it and cannot change it, outsiders never see it", async ({ browser }) => {
  test.setTimeout(120_000);
  const tag = crypto.randomUUID().slice(0, 12);
  const platform = `ctp-${tag}@plan-markup.test`;
  const boss = `ctboss-${tag}@plan-markup.test`;
  const member = `ctmember-${tag}@plan-markup.test`;
  const outsider = `ctout-${tag}@plan-markup.test`;
  const company = `Tool Sets Co ${tag}`;
  for (const email of [platform, boss, member, outsider]) await makeActiveUser(email, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true where email = $1", [platform]);
  await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, company, boss]);
  await sql(
    `insert into public.company_members (user_id, company_id, role)
     select (select id from public.profiles where email = $1), (select id from public.companies where name = $2), 'member'`,
    [member, company],
  );

  const bossCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const outsiderCtx = await browser.newContext();
  try {
    // The admin imports a set and publishes it.
    const page = await bossCtx.newPage();
    await openWorkspace(page, boss);
    await chest(page)
      .getByTestId("import-btx-input")
      .setInputFiles({ name: "synthetic.btx", mimeType: "application/octet-stream", buffer: readFileSync(SYNTHETIC) });
    await expect(page.getByText("Synthetic Tools — 5 tools", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(chest(page).getByTestId("company-set")).toHaveCount(0);

    // A member has nothing before it is published, and no Publish control of their own.
    const memberPage = await memberCtx.newPage();
    await openWorkspace(memberPage, member);
    await expect(chest(memberPage).getByText("No tool sets yet")).toBeVisible();

    await chest(page).getByRole("button", { name: "Publish Synthetic Tools to your company" }).click();
    await expect(page.getByText("“Synthetic Tools” is now a company tool set", { exact: true })).toBeVisible();
    await expect(page.getByText(`Everyone in ${company} can use it. Only you can change it.`, { exact: true })).toBeVisible();
    await expect(chest(page).getByTestId("company-set")).toHaveText("Company");
    // Still the admin's own set.
    await expect(chest(page).getByRole("button", { name: "Rename Synthetic Tools" })).toBeVisible();

    // The member: the company set, drawn, with Export only.
    await memberPage.reload();
    await showChest(memberPage);
    await expect(setNames(memberPage)).toHaveText(["Synthetic Tools (5)"], { timeout: 15_000 });
    await expect(chest(memberPage).getByTestId("company-set")).toHaveText("Company");
    await expect(chest(memberPage).getByTestId("tool")).toHaveCount(5);
    await expect.poll(() => drawn(memberPage)).toEqual([true, true, true, true, true]);
    await expect(chest(memberPage).getByRole("button", { name: "Export Synthetic Tools" })).toBeVisible();
    for (const name of [/^Rename /, /^Delete /, /^Move /, /^Publish /, /^Withdraw /]) {
      await expect(chest(memberPage).getByRole("button", { name })).toHaveCount(0);
    }
    // The member's own sets sit under it, and are theirs to change.
    await chest(memberPage).getByRole("button", { name: "Create set" }).click();
    const field = chest(memberPage).getByRole("textbox", { name: "New tool set name" });
    await field.fill("Mine");
    await field.press("Enter");
    await expect(setNames(memberPage)).toHaveText(["Synthetic Tools (5)", "Mine (0)"]);
    await expect(chest(memberPage).getByRole("button", { name: "Rename Mine" })).toBeVisible();
    await expect(chest(memberPage).getByRole("button", { name: /^Publish / })).toHaveCount(0);

    // Someone outside the company sees nothing.
    const outsiderPage = await outsiderCtx.newPage();
    await openWorkspace(outsiderPage, outsider);
    await expect(chest(outsiderPage).getByText("No tool sets yet")).toBeVisible();

    // Withdrawn: the member no longer has it.
    await chest(page).getByRole("button", { name: "Withdraw Synthetic Tools from your company" }).click();
    await expect(page.getByText("“Synthetic Tools” is no longer a company tool set", { exact: true })).toBeVisible();
    await expect(chest(page).getByTestId("company-set")).toHaveCount(0);
    await memberPage.reload();
    await showChest(memberPage);
    await expect(setNames(memberPage)).toHaveText(["Mine (0)"], { timeout: 15_000 });

    expect(await audit(company)).toEqual([
      { action: "company.tool_set_published", actor: boss, name: "Synthetic Tools" },
      { action: "company.tool_set_withdrawn", actor: boss, name: "Synthetic Tools" },
    ]);
  } finally {
    await bossCtx.close();
    await memberCtx.close();
    await outsiderCtx.close();
    await sql("delete from public.companies where name like $1", [`%${tag}%`]);
    await deleteUser(platform, boss, member, outsider);
  }
});
