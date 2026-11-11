import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { DB_URL } from "./global-setup";
import { formAlert, signIn } from "./helpers";

// Story 10.2: reset a forgotten password by email.

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:56324";
const OLD = "old password for reset e2e";

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** An active account of this test's own, with a known password. */
async function makeActiveUser(email: string) {
  await sql(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                             confirmation_token, recovery_token, email_change, email_change_token_new)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
             extensions.crypt($2, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`,
    [email, OLD],
  );
  await sql(
    `insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
     select u.id, u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
     from auth.users u where u.email = $1`,
    [email],
  );
  await sql(`update public.profiles set status = 'active' where id = (select id from auth.users where email = $1)`, [email]);
}

async function resetLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Subject: string };
      expect(msg.Subject).toBe("Reset your Plan Markup password");
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
      if (!href) throw new Error("no reset link in the email");
      const url = new URL(href.replaceAll("&amp;", "&"));
      return url.pathname + url.search;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${email}`);
}

async function clearResetLimits() {
  await sql("delete from app.rate_limits where bucket in ('reset_ip', 'reset_email')");
}

async function requestLink(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test("reset by email: single-use link, new password, other sessions signed out", async ({ browser }) => {
  const email = `reset-${Date.now()}-${test.info().retry}@plan-markup.test`;
  const fresh = `new password ${crypto.randomUUID()}`;
  await clearResetLimits();
  await makeActiveUser(email);
  const other = await browser.newContext();
  const ctx = await browser.newContext();
  try {
    // Another device, signed in with the old password.
    const otherPage = await other.newPage();
    await otherPage.goto("/sign-in");
    await signIn(otherPage, email, OLD);
    await expect(otherPage).toHaveURL("/workspace");

    // An unknown email gets the same answer.
    const page = await ctx.newPage();
    await requestLink(page, `nobody-${Date.now()}@plan-markup.test`);
    await requestLink(page, email);

    // /reset-password without the link is refused.
    await page.goto("/sign-in");
    await signIn(page, email, OLD);
    await expect(page).toHaveURL("/workspace");
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Open the link from your email" })).toBeVisible();
    await ctx.clearCookies();

    // The link signs in and asks for a new password.
    const link = await resetLink(email);
    expect(link).toMatch(/^\/auth\/confirm\?token_hash=[\w-]+&type=recovery$/);
    await page.goto(link);
    await expect(page).toHaveURL("/reset-password");
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel("New password").fill("too-short");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel("New password").fill(fresh);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL("/workspace");

    // The link works once.
    await ctx.clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL("/sign-in?link=invalid");

    // The other device is signed out; the old password no longer works, the new one does.
    await otherPage.goto("/workspace");
    await expect(otherPage).toHaveURL(/\/sign-in/);
    await page.goto("/sign-in");
    await signIn(page, email, OLD);
    await expect(formAlert(page)).toContainText("Email or password is incorrect.");
    await signIn(page, email, fresh);
    await expect(page).toHaveURL("/workspace");
  } finally {
    await other.close();
    await ctx.close();
    await sql("delete from auth.users where email = $1", [email]);
    await clearResetLimits();
  }
});
