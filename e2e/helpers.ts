import { test, type Page } from "@playwright/test";
import pg from "pg";
import { rateLimitKeyHash } from "../src/lib/auth/rate-limit-key";
import { DB_URL } from "./global-setup";

// Seed accounts (supabase/seed.sql), all with password123.
export const PASSWORD = "password123";
export const ACTIVE = "user@plan-markup.test";

/** The form-level alert (Next's route announcer is also role="alert"). */
export function formAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}

/**
 * Clears the sign-in counters that a whole e2e run would otherwise exhaust:
 * every spec signs in from the same address (30 per 15 min) and most as the
 * same few accounts (10 per 15 min each), so the later specs of a long run
 * were throttled (Story 4.2: CI failed once there were more specs). The
 * limiter itself is covered by auth.spec.ts, which keeps its counters.
 */
async function clearSignInLimits(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("delete from app.rate_limits where bucket = 'sign_in_ip' or (bucket = 'sign_in_email' and key_hash = $1)", [
      rateLimitKeyHash("sign_in_email", email),
    ]);
  } finally {
    await client.end();
  }
}

/** The seed account most specs sign in as; swapped for a user of the test's own (below). */
export const SHARED_ADMIN = "admin@plan-markup.test";

/**
 * Story 6.4: since edits are saved (6.2) and restored when a file is opened
 * again (6.4), specs signing in as one shared account would see each other's
 * markups on the same fixture. Each test attempt gets its own active account
 * instead (made on demand, a platform admin like the seed admin, its markup
 * sets cleared), so it always opens files to an empty set.
 */
async function isolatedAdmin(): Promise<string> {
  const info = test.info();
  const email = `e2e-${info.testId}-r${info.retry}@plan-markup.test`.toLowerCase();
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                               confirmation_token, recovery_token, email_change, email_change_token_new)
       select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1::text,
              extensions.crypt($2, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', '{"name":"Dev Admin"}', now(), now(), '', '', '', ''
       where not exists (select 1 from auth.users where email = $1::text)`,
      [email, PASSWORD],
    );
    await client.query(
      `insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
       select u.id, u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
       from auth.users u where u.email = $1 and not exists (select 1 from auth.identities i where i.user_id = u.id)`,
      [email],
    );
    await client.query(`update public.profiles set status = 'active', is_platform_admin = true where id = (select id from auth.users where email = $1)`, [email]);
    await client.query(`delete from public.drawings where owner_id = (select id from auth.users where email = $1)`, [email]);
  } finally {
    await client.end();
  }
  return email;
}

export async function signIn(page: Page, email: string, password = PASSWORD, options: { keepRateLimits?: boolean } = {}) {
  if (email === SHARED_ADMIN && password === PASSWORD) email = await isolatedAdmin();
  if (!options.keepRateLimits) await clearSignInLimits(email);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Arms a measuring tool from the ToolRail's measure menu (the rail shows one measuring tool at a time). */
export async function armMeasureTool(page: Page, name: string) {
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "More measure tools" }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
