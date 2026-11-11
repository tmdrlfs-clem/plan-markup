// Guards the local Supabase Auth session settings (NFR14, NFR17).
// A small section-aware line parser: no TOML dependency needed for these keys.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = fileURLToPath(new URL("../../supabase/config.toml", import.meta.url));

type Sections = Map<string, Map<string, string>>;

/** Parses active (uncommented) `[section]` headers and `key = value` lines. Values stay raw. */
function parseSections(text: string): Sections {
  const sections: Sections = new Map();
  let current = "";
  sections.set(current, new Map());
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (kv) sections.get(current)!.set(kv[1], kv[2]);
  }
  return sections;
}

const sections = parseSections(readFileSync(CONFIG_PATH, "utf8"));
const auth = sections.get("auth");
const authSessions = sections.get("auth.sessions");

describe("supabase/config.toml auth settings", () => {
  it("has an active [auth] section", () => {
    expect(auth).toBeDefined();
  });

  it.each([
    ["site_url", '"http://localhost:3020"'],
    ["additional_redirect_urls", '["http://localhost:3020", "http://127.0.0.1:3020"]'],
    ["jwt_expiry", "600"],
    ["enable_refresh_token_rotation", "true"],
    ["refresh_token_reuse_interval", "10"],
    ["minimum_password_length", "12"],
    ["enable_signup", "true"],
  ])("[auth] %s = %s", (key, value) => {
    expect(auth?.get(key)).toBe(value);
  });

  it("has [auth.sessions] uncommented with a 30-day timebox and a 7-day inactivity timeout", () => {
    expect(authSessions).toBeDefined();
    expect(authSessions?.get("timebox")).toBe('"720h"');
    expect(authSessions?.get("inactivity_timeout")).toBe('"168h"');
  });

  it("requires email confirmation before sign-in (Story 10.1)", () => {
    expect(sections.get("auth.email")?.get("enable_confirmations")).toBe("true");
  });

  it.each([
    ["auth.email.template.confirmation", "./supabase/templates/confirmation.html"],
    ["auth.email.template.recovery", "./supabase/templates/recovery.html"],
  ])("[%s] uses %s (links to /auth/confirm with a token hash)", (section, path) => {
    expect(sections.get(section)?.get("content_path")).toBe(`"${path}"`);
    const html = readFileSync(fileURLToPath(new URL(`../../${path.slice(2)}`, import.meta.url)), "utf8");
    expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}");
  });

  it("does not enable a custom access token hook", () => {
    expect(sections.has("auth.hook.custom_access_token")).toBe(false);
  });
});

describe("parseSections", () => {
  it("ignores commented-out sections and keys", () => {
    const parsed = parseSections("[a]\nx = 1\n# [b]\n# y = 2\n");
    expect(parsed.get("a")?.get("x")).toBe("1");
    expect(parsed.has("b")).toBe(false);
    expect(parsed.get("a")?.has("y")).toBe(false);
  });
});
