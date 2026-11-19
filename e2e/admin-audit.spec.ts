import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// The platform admin's audit log screen (NFR34): read only, searchable by person or company.

const PASSWORD = "audit log e2e password";

test("audit log: entries name people and companies, search and area filters work, nobody else can open it", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const admin = `audadm-${tag}@plan-markup.test`;
  const user = `auduser-${tag}@plan-markup.test`;
  const company = `Audit Co ${tag}`;
  const adminCtx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const userCtx = await browser.newContext();
  let companyId: string | null = null;
  try {
    await makeActiveUser(admin, PASSWORD);
    await makeActiveUser(user, PASSWORD);
    await sql("update public.profiles set is_platform_admin = true, name = 'Ada Audit' where email = $1", [admin]);
    await sql("update public.profiles set name = 'Uma Audit' where email = $1", [user]);
    const [{ id: adminId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [admin]);
    const [{ id: userId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [user]);
    [{ id: companyId }] = await sql<{ id: string }>("insert into public.companies (name) values ($1) returning id", [company]);
    await sql(
      `insert into public.audit_log (occurred_at, actor_id, action, target_type, target_id, detail) values
         (now() - interval '2 minutes', $1, 'user.activated', 'user', $2, '{"from": "pending", "to": "active"}'),
         (now() - interval '1 minute', $1, 'company.member_role_changed', 'company', $3, jsonb_build_object('user_id', $2::text, 'from', 'member', 'to', 'admin')),
         (now(), $1, 'support.markup_sets_viewed', 'user', $2, '{"sets": 3}')`,
      [adminId, userId, companyId],
    );

    const page = await adminCtx.newPage();
    await page.goto(`/sign-in?next=${encodeURIComponent("/admin/audit")}`);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");

    // Search by the user's name: all three entries, newest first.
    await page.getByRole("searchbox", { name: "Person or company" }).fill(`auduser-${tag}`);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(`/admin/audit?q=auduser-${tag}`);
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText("Looked up the account's markup sets (3 sets)");
    await expect(rows.nth(2)).toContainText("Changed the role of Uma Audit: member → admin");
    await expect(rows.nth(2)).toContainText(company);
    await expect(rows.nth(3)).toContainText("Activated the account (was waiting)");
    await expect(rows.nth(3)).toContainText("Ada Audit");
    await expect(page.getByRole("status")).toHaveText("1–3 of 3 entries");

    // The area filter keeps the search.
    await page.getByRole("link", { name: "Companies" }).click();
    await expect(page).toHaveURL(`/admin/audit?area=company&q=auduser-${tag}`);
    await expect(rows).toHaveCount(2);

    // A company's name finds its entries.
    await page.goto(`/admin/audit?q=${encodeURIComponent(company)}`);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("Changed the role of Uma Audit");

    await page.goto(`/admin/audit?q=nobody-${tag}`);
    await expect(page.getByText(`Nothing here involves "nobody-${tag}".`)).toBeVisible();

    await page.goto(`/admin/audit?q=auduser-${tag}`);
    await page.getByText("Details").first().click();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    // The table scrolls inside its own box; the page itself does not.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Anyone but the platform admin gets a 404.
    const userPage = await userCtx.newPage();
    await userPage.goto("/sign-in");
    await signIn(userPage, user, PASSWORD);
    await expect(userPage).toHaveURL("/workspace");
    expect((await userPage.goto("/admin/audit"))?.status()).toBe(404);
  } finally {
    await adminCtx.close();
    await userCtx.close();
    if (companyId) await sql("delete from public.companies where id = $1", [companyId]);
    await deleteUser(admin, user);
  }
});
