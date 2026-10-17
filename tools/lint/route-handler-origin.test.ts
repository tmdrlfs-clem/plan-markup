import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: projectRoot });

async function messages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.severity === 2);
}

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  return (await messages(code, filePath)).map((m) => m.ruleId ?? "parse-error");
}

const ROUTE = "src/app/api/__probe__/route.ts";
const FEATURE = "src/features/__probe__.ts";
const TIMEOUT = 30_000;
const PRELUDE =
  "declare function withOriginCheck<T>(h: T): T;\n" +
  "declare const x: () => Response;\n";

describe("route handlers must use withOriginCheck (NFR29)", () => {
  it.each([
    "export async function POST() { return new Response(); }",
    "export function DELETE() { return new Response(); }",
    "export const PATCH = async () => new Response();",
    "const h = withOriginCheck(x);\nexport { h as PUT };",
  ])(
    "reports %s",
    async (code) => {
      const found = await messages(`${PRELUDE}${code}\n`, ROUTE);
      expect(found.map((m) => m.ruleId)).toContain("no-restricted-syntax");
      expect(found.some((m) => m.message.includes("NFR29"))).toBe(true);
    },
    TIMEOUT,
  );

  it.each([
    "export const POST = withOriginCheck(async () => new Response());",
    "export async function GET() { return new Response(); }",
  ])(
    "allows %s",
    async (code) => {
      expect(await ruleIds(`${PRELUDE}${code}\n`, ROUTE)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "keeps the NFR11 auth ban in route files",
    async () => {
      const code =
        "declare const supabase: { auth: { getSession(): unknown } };\n" +
        "export async function GET() { supabase.auth.getSession(); return new Response(); }\n";
      const found = await messages(code, ROUTE);
      expect(found.some((m) => m.message.includes("NFR11"))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "is scoped to route files",
    async () => {
      expect(await ruleIds("export async function POST() { return new Response(); }\n", FEATURE)).toEqual([]);
    },
    TIMEOUT,
  );
});
