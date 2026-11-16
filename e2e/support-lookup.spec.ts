import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.10: the platform admin looks up an account's markup sets for support.

const PASSWORD = "support lookup e2e password";

const lookups = (admin: string, user: string) =>
  sql<{ n: number }>(
    `select count(*)::int as n from public.audit_log
      where action = 'support.markup_sets_viewed'
        and actor_id = (select id from public.profiles where email = $1)
        and target_id = (select id from public.profiles where email = $2)`,
    [admin, user],
  );

test("support lookup: file names and counts only, each lookup recorded, nobody else can open it", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const admin = `supadm-${tag}@plan-markup.test`;
  const user = `supuser-${tag}@plan-markup.test`;
  const filename = `L3 RCP ${tag}.pdf`;
  const adminCtx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const userCtx = await browser.newContext();
  try {
    await makeActiveUser(admin, PASSWORD);
    await makeActiveUser(user, PASSWORD);
    await sql("update public.profiles set is_platform_admin = true, name = 'Ada Admin' where email = $1", [admin]);
    await sql("update public.profiles set name = 'Uma User' where email = $1", [user]);
    // The user's set: a 4-page file with two markups, one carrying text that must never show.
    await sql(
      `with d as (insert into public.drawings (owner_id, title) select id, $2 from public.profiles where email = $1 returning id),
            f as (insert into public.drawing_files (drawing_id, sha256, page_count, filename) select id, repeat('f', 64), 4, $2 from d returning id),
            p as (insert into public.pages (drawing_file_id, index, crop_box, width, height) select id, 0, array[0, 0, 842, 595], 842, 595 from f returning id)
       insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id)
       select gen_random_uuid(), (select id from d), (select id from p), 'text', '{"points": []}', '{}', props::jsonb,
              (select id from public.profiles where email = $1)
       from (values ('{"text": "Confidential markup text"}'), ('{}')) v(props)`,
      [user, filename],
    );

    const page = await adminCtx.newPage();
    await page.goto(`/sign-in?next=${encodeURIComponent(`/admin/users?status=all&q=${tag}`)}`);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(`/admin/users?status=all&q=${tag}`);
    // Listing accounts is not a lookup.
    await expect(page.getByRole("link", { name: "Markup sets of Uma User" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await lookups(admin, user)).toEqual([{ n: 0 }]);

    await page.getByRole("link", { name: "Markup sets of Uma User" }).click();
    await expect(page.getByRole("heading", { name: "Markup sets of Uma User" })).toBeVisible();
    await expect(page.getByText(`${user} · Active`)).toBeVisible();
    await expect(page.getByText(/This lookup has been recorded in the audit log/)).toBeVisible();
    const row = page.getByRole("table", { name: "Markup sets of Uma User" }).getByRole("row", { name: new RegExp(tag) });
    await expect(row).toContainText(filename);
    expect((await row.getByRole("cell").allTextContents()).slice(0, 2)).toEqual(["4", "2"]);
    await expect(page.getByRole("status")).toContainText("1 markup set");

    // Names and counts only: no markup content, and nothing on the page leads to the drawing.
    expect(await page.content()).not.toContain("Confidential markup text");
    await expect(page.getByRole("main").getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // One lookup so far; opening it again is a second one.
    expect(await lookups(admin, user)).toEqual([{ n: 1 }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Markup sets of Uma User" })).toBeVisible();
    expect(await lookups(admin, user)).toEqual([{ n: 2 }]);

    // Unknown and malformed accounts are a 404 and record nothing.
    expect((await page.goto("/admin/users/00000000-0000-4000-8000-0000000000ff/support"))?.status()).toBe(404);
    expect((await page.goto("/admin/users/not-an-id/support"))?.status()).toBe(404);

    // The user themselves cannot open the lookup, on their own account or anyone's.
    const userPage = await userCtx.newPage();
    await userPage.goto("/sign-in");
    await signIn(userPage, user, PASSWORD);
    await expect(userPage).toHaveURL("/workspace");
    const [{ id }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [user]);
    expect((await userPage.goto(`/admin/users/${id}/support`))?.status()).toBe(404);
    expect(await lookups(admin, user)).toEqual([{ n: 2 }]);
    expect(await sql("select count(*)::int as n from public.audit_log where action = 'support.markup_sets_viewed' and actor_id = $1", [id])).toEqual([{ n: 0 }]);
  } finally {
    await adminCtx.close();
    await userCtx.close();
    await deleteUser(admin, user);
  }
});
