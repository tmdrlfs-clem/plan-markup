import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: projectRoot });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? "parse-error");
}

const FEATURE = "src/features/__probe__.ts";
const AUTH_LIB = "src/lib/auth/__probe__.ts";
const TIMEOUT = 30_000;

const PRELUDE =
  "type Fn = (...args: unknown[]) => unknown;\n" +
  "declare const supabase: { auth: Record<string, Fn> & { admin: Record<string, Fn> } };\n" +
  "declare const auth: Record<string, Fn> | undefined;\n";

describe("auth lint boundaries are active (NFR11)", () => {
  it.each([
    "supabase.auth.getSession();",
    "supabase.auth.getUser();",
    "supabase.auth.getClaims();",
    "auth?.getUser();",
    'auth["getSession"]();',
  ])(
    "bans %s outside src/lib/auth",
    async (call) => {
      const ids = await ruleIds(`${PRELUDE}export const p = ${call}\n`, FEATURE);
      expect(ids).toContain("no-restricted-syntax");
    },
    TIMEOUT,
  );

  it(
    "allows getUser() inside src/lib/auth",
    async () => {
      const ids = await ruleIds(`${PRELUDE}export const p = supabase.auth.getUser();\n`, AUTH_LIB);
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "does not flag auth.admin.getUserById()",
    async () => {
      const ids = await ruleIds(
        `${PRELUDE}export const p = supabase.auth.admin.getUserById("x");\n`,
        FEATURE,
      );
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(["src/app/__probe__.tsx", "src/proxy.ts"])(
    "bans @supabase/* imports in %s",
    async (filePath) => {
      const ids = await ruleIds(
        'import { createServerClient } from "@supabase/ssr";\nexport const c = createServerClient;\n',
        filePath,
      );
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "allows @supabase/* imports in src/lib/supabase",
    async () => {
      const ids = await ruleIds(
        'import { createServerClient } from "@supabase/ssr";\nexport const c = createServerClient;\n',
        "src/lib/supabase/__probe__.ts",
      );
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );
});
