import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { DB_URL } from "./global-setup";
import { formAlert, signIn } from "./helpers";

// Story 10.1: sign up, confirm the email, wait for activation.

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:56324";

/** The confirmation link from the email Auth sent (Mailpit, the local mail catcher). */
async function confirmationLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Subject: string };
      expect(msg.Subject).toBe("Confirm your Plan Markup account");
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
      if (!href) throw new Error("no confirmation link in the email");
      const url = new URL(href.replaceAll("&amp;", "&"));
      return url.pathname + url.search;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${email}`);
}

/** With Turnstile keys set (a manual run), waits for the check's token; CI runs without them. */
async function waitForCheck(page: Page) {
  if ((await page.getByTestId("turnstile").count()) === 0) return;
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 15_000 });
}

/** Sign-up counters per email; a rerun of this spec would otherwise hit them. */
async function clearSignUpLimits() {
  await sql("delete from app.rate_limits where bucket in ('sign_up_ip', 'sign_up_email')");
}

test("sign up, confirm the email, then wait for approval", async ({ page }) => {
  const email = `signup-${Date.now()}-${test.info().retry}@plan-markup.test`;
  // Random, so the leaked-password check cannot flag it.
  const password = `plan markup ${crypto.randomUUID()}`;
  await clearSignUpLimits();

  try {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL("/sign-up");

    // The length rule shows on the field.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("short-pass1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(password);
    await waitForCheck(page);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    // The profile is pending and the email unconfirmed.
    const [row] = await sql<{ status: string; confirmed: boolean }>(
      `select p.status, u.email_confirmed_at is not null as confirmed
         from auth.users u join public.profiles p on p.id = u.id where u.email = $1`,
      [email],
    );
    expect(row).toMatchObject({ status: "pending", confirmed: false });
    const link = await confirmationLink(email);
    expect(link).toMatch(/^\/auth\/confirm\?token_hash=[\w-]+&type=email$/);

    // Signing in before confirming is refused with a reason.
    await page.goto("/sign-in");
    await signIn(page, email, password);
    await expect(formAlert(page)).toContainText("Confirm your email first");

    // The emailed link (supabase/templates/confirmation.html) confirms and signs in.
    await page.goto(link);
    await expect(page).toHaveURL("/pending-activation");
    await expect(page.getByRole("heading", { name: "Your account is waiting for approval" })).toBeVisible();
    await page.goto("/workspace");
    await expect(page).toHaveURL("/pending-activation");

    // The link works once.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL("/sign-in?link=invalid");
    await expect(formAlert(page)).toContainText("expired or was already used");

    // Signing up again with the same email gives the same answer (no account enumeration).
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await waitForCheck(page);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  } finally {
    await sql("delete from auth.users where email = $1", [email]);
    await clearSignUpLimits();
  }
});
