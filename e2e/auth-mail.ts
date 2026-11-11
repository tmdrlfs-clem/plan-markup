// Epic 10 e2e helpers: SQL against the local stack, accounts of a test's own,
// and links from the emails Auth sent (Mailpit, the local mail catcher).
import { expect } from "@playwright/test";
import pg from "pg";
import { DB_URL } from "./global-setup";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:56324";

export async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** An active (confirmed) account with this email and password. */
export async function makeActiveUser(email: string, password: string): Promise<void> {
  await sql(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                             confirmation_token, recovery_token, email_change, email_change_token_new,
                             email_change_token_current)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
             extensions.crypt($2, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '')`,
    [email, password],
  );
  await sql(
    `insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
     select u.id, u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
     from auth.users u where u.email = $1`,
    [email],
  );
  await sql(`update public.profiles set status = 'active' where id = (select id from auth.users where email = $1)`, [email]);
}

export async function deleteUser(...emails: string[]): Promise<void> {
  await sql("delete from auth.users where email = any($1)", [emails]);
}

export async function clearLimits(...buckets: string[]): Promise<void> {
  await sql("delete from app.rate_limits where bucket = any($1)", [buckets]);
}

/** The /auth/confirm link (path and query) of the newest email to `to` with this subject. */
export async function emailLink(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Subject: string };
      expect(msg.Subject).toBe(subject);
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
      if (!href) throw new Error("no /auth/confirm link in the email");
      const url = new URL(href.replaceAll("&amp;", "&"));
      return url.pathname + url.search;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no "${subject}" email to ${to}`);
}
