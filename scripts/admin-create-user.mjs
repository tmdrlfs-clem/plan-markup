// Creates a confirmed auth user with an active profile (Story 1.5, AC 10).
// Server-side only: lives outside src/ so it is never bundled.
//
//   npm run admin:create-user -- --email <email> [--name "<name>"] [--password-stdin] [--yes]
//
// Env (.env.local via --env-file-if-exists): NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. Never logs the key. is_platform_admin is never set here.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const USAGE =
  'Usage: npm run admin:create-user -- --email <email> [--name "<name>"] [--password-stdin] [--yes]';

/**
 * @param {string[]} argv
 * @returns {{ email?: string, name?: string, passwordStdin: boolean, yes: boolean }}
 */
export function parseArgs(argv) {
  const out = { email: undefined, name: undefined, passwordStdin: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email" || arg === "--name") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      out[arg.slice(2)] = value;
      i += 1;
    } else if (arg === "--password-stdin") {
      out.passwordStdin = true;
    } else if (arg === "--yes") {
      out.yes = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises and validates the input. Returns errors instead of throwing.
 * @param {{ email?: string, name?: string, password?: string }} input
 * @returns {{ ok: true, email: string, name: string, password?: string } | { ok: false, errors: string[] }}
 */
export function validateInput({ email, name, password }) {
  const errors = [];
  const cleanEmail = (email ?? "").trim().toLowerCase();
  const cleanName = (name ?? "").trim();
  if (cleanEmail === "") errors.push("--email is required.");
  else if (cleanEmail.length > 254 || !EMAIL_SHAPE.test(cleanEmail)) {
    errors.push("--email is not a valid email address.");
  }
  if (cleanName.length > 100) errors.push("--name must be at most 100 characters.");
  if (password !== undefined && (password.length < 12 || password.length > 128)) {
    errors.push("The password must be 12 to 128 characters.");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, email: cleanEmail, name: cleanName, password };
}

/** True for localhost and 127.0.0.1 (any port). */
export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** 24-character URL-safe random password (18 random bytes). */
export function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(`${err.message}\n${USAGE}`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run env:local for the local stack)");
  }
  if (!isLocalUrl(url)) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // keep the raw value
    }
    process.stderr.write(`Target is not local: ${host}\n`);
    if (!args.yes) fail("Re-run with --yes to create the user on this project.");
  }

  // Read stdin only when asked: reading it otherwise hangs non-interactive shells.
  const stdinPassword = args.passwordStdin ? await readStdin() : undefined;
  const input = validateInput({ email: args.email, name: args.name, password: stdinPassword });
  if (!input.ok) fail(`${input.errors.join("\n")}\n${USAGE}`);

  const generated = input.password === undefined;
  const password = input.password ?? generatePassword();

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The new-user trigger creates a pending profile. user_metadata.name only
  // seeds the display name, never authorization.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (createError || !created?.user) {
    if (createError?.code === "email_exists" || createError?.status === 422) {
      fail("A user with this email already exists.");
    }
    fail(`Could not create the user: ${createError?.code ?? createError?.message ?? "unknown error"}`);
  }
  const userId = created.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .update({ status: "active" })
    .eq("id", userId)
    .select("id, status")
    .single();
  if (profileError || profile?.status !== "active") {
    await supabase.auth.admin.deleteUser(userId);
    fail(`Could not activate the profile; the user was removed again. ${profileError?.code ?? ""}`.trim());
  }

  process.stdout.write(`Created active user ${input.email} (${userId}).\n`);
  if (generated) process.stdout.write(`Temporary password: ${password}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
