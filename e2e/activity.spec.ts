import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.9: activity for the platform admin (every company) and for a company admin (their own).

const PASSWORD = "activity e2e password";

/** The cells of a table row after its name. */
async function cells(row: Locator): Promise<string[]> {
  return row.getByRole("cell").allTextContents();
}

test("activity: the platform admin sees every company; a company admin sees their own; no drawing content is shown", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const platform = `acp-${tag}@plan-markup.test`;
  const boss = `acboss-${tag}@plan-markup.test`;
  const member = `acmember-${tag}@plan-markup.test`;
  const rival = `acrival-${tag}@plan-markup.test`;
  const company = `Activity Co ${tag}`;
  const other = `Rival Co ${tag}`;
  const secret = `Secret client plan ${tag}.pdf`;
  const adminCtx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const bossCtx = await browser.newContext();
  try {
    for (const email of [platform, boss, member, rival]) await makeActiveUser(email, PASSWORD);
    await sql("update public.profiles set is_platform_admin = true, name = 'Ada Admin' where email = $1", [platform]);
    await sql("update public.profiles set name = 'Bo Boss' where email = $1", [boss]);
    await sql("update public.profiles set name = 'Mel Member' where email = $1", [member]);
    await sql("update public.profiles set name = 'Ria Rival' where email = $1", [rival]);
    await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, company, boss]);
    await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, other, rival]);
    await sql(
      `insert into public.company_members (user_id, company_id, role)
       select (select id from public.profiles where email = $1), (select id from public.companies where name = $2), 'member'`,
      [member, company],
    );

    // The member: a markup set with 3 markups now and 1 a week ago; 2 exports now and 1 a week ago; 1 print and 1 Place heads run now.
    const [{ drawing, page }] = await sql<{ drawing: string; page: string }>(
      `with d as (insert into public.drawings (owner_id, title) select id, $2 from public.profiles where email = $1 returning id),
            f as (insert into public.drawing_files (drawing_id, sha256, page_count, filename) select id, repeat('e', 64), 1, $2 from d returning id),
            p as (insert into public.pages (drawing_file_id, index, crop_box, width, height) select id, 0, array[0, 0, 842, 595], 842, 595 from f returning id)
       select (select id from d) as drawing, (select id from p) as page`,
      [member, secret],
    );
    await sql(
      `insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id, created_at)
       select gen_random_uuid(), $1, $2, 'line', '{"points": []}', '{}', '{}', (select id from public.profiles where email = $3), at
       from (values (now()), (now()), (now()), (now() - interval '7 days')) v(at)`,
      [drawing, page, member],
    );
    // activity_events sets its own time and checks the caller, so the rows are written with those triggers off.
    await sql(
      `do $do$ begin
         alter table public.activity_events disable trigger user;
         insert into public.activity_events (user_id, name, drawing_id, page_count, markup_count, kind, occurred_at)
         select (select id from public.profiles where email = '${member}'), n, '${drawing}', 1, 3, k, at
         from (values ('markup.exported', 'editable', now()), ('markup.exported', 'flattened', now()),
                      ('markup.exported', 'flattened', now() - interval '7 days'), ('drawing.printed', 'with_markups', now()),
                      ('sprinkler.placed', 'all_zones', now())) v(n, k, at);
         alter table public.activity_events enable trigger user;
       end $do$`,
    );

    // The platform admin: both companies, with totals.
    const page1 = await adminCtx.newPage();
    await page1.goto("/sign-in?next=%2Fadmin%2Factivity");
    await signIn(page1, platform, PASSWORD);
    await expect(page1).toHaveURL("/admin/activity");
    await expect(page1.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
    await expect(page1.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
    // This week, by kind of work: last active, days active, drawings, markups, PDFs, prints, head layouts.
    const table = page1.getByRole("table", { name: "Activity by company and account, this week" });
    const memberCells = await cells(table.getByRole("row", { name: new RegExp(member) }));
    expect(memberCells[0]).not.toBe("Never");
    expect(memberCells.slice(1)).toEqual(["1 of 7", "1", "3", "2", "1", "1"]);
    // The company's row: one of its two people was active, and the sums.
    const companyCells = await cells(table.getByRole("row", { name: new RegExp(`^${company} 2 people`) }));
    expect(companyCells.slice(1)).toEqual(["1 of 2", "1", "3", "2", "1", "1"]);
    expect((await cells(table.getByRole("row", { name: new RegExp(boss) }))).slice(1)).toEqual(["0 of 7", "0", "0", "0", "0", "0"]);
    await expect(table.getByRole("row", { name: new RegExp(`^${other} 1 person`) })).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(rival) })).toBeVisible();
    const weekAxe = await new AxeBuilder({ page: page1 }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(weekAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page1.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Four weeks: markups (this week, last, 2 and 3 weeks ago, all time) and PDFs week by week.
    await page1.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Four weeks" }).click();
    await expect(page1).toHaveURL("/admin/activity?view=weeks");
    const weeks = page1.getByRole("table", { name: "Activity by company and account, the last four weeks" });
    expect(await cells(weeks.getByRole("row", { name: new RegExp(member) }))).toEqual(["3", "1", "0", "0", "4", "2", "1", "0", "0"]);
    expect(await cells(weeks.getByRole("row", { name: new RegExp(`^${company} 2 people`) }))).toEqual(["3", "1", "0", "0", "4", "2", "1", "0", "0"]);

    // Counts only: neither the title nor the file name is anywhere on the page.
    await expect(page1.getByText(secret)).toHaveCount(0);
    expect(await page1.content()).not.toContain("Secret client plan");

    const axe = await new AxeBuilder({ page: page1 }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page1.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // The company area is not the platform admin's.
    expect((await page1.goto("/company/activity"))?.status()).toBe(404);

    // The company admin: their own company only.
    const page2 = await bossCtx.newPage();
    await page2.goto("/sign-in?next=%2Fcompany%2Fmembers");
    await signIn(page2, boss, PASSWORD);
    await expect(page2).toHaveURL("/company/members");
    await page2.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Activity" }).click();
    await expect(page2).toHaveURL("/company/activity");
    const own = page2.getByRole("table", { name: `Activity of ${company}, this week` });
    expect((await cells(own.getByRole("row", { name: /^Whole company 2 people/ }))).slice(1)).toEqual(["1 of 2", "1", "3", "2", "1", "1"]);
    expect((await cells(own.getByRole("row", { name: new RegExp(member) }))).slice(1)).toEqual(["1 of 7", "1", "3", "2", "1", "1"]);
    await expect(own.getByRole("row", { name: new RegExp(boss) })).toBeVisible();
    await expect(page2.getByText(rival)).toHaveCount(0);
    await expect(page2.getByText(other)).toHaveCount(0);
    expect(await page2.content()).not.toContain("Secret client plan");
    const ownAxe = await new AxeBuilder({ page: page2 }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(ownAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    // The platform's activity is not theirs.
    expect((await page2.goto("/admin/activity"))?.status()).toBe(404);

    // A plain member has neither.
    await page2.context().clearCookies();
    await page2.goto("/sign-in");
    await signIn(page2, member, PASSWORD);
    await expect(page2).toHaveURL("/workspace");
    expect((await page2.goto("/company/activity"))?.status()).toBe(404);
    expect((await page2.goto("/admin/activity"))?.status()).toBe(404);
  } finally {
    await adminCtx.close();
    await bossCtx.close();
    await sql("delete from public.companies where name like $1", [`%${tag}%`]);
    await deleteUser(platform, boss, member, rival);
  }
});
